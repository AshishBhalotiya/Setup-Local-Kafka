import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { Kafka, logLevel } from 'kafkajs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve static UI
app.use(express.static(path.join(__dirname, '..', 'public')));

// Kafka connection: auto-detect brokers. Prefer container broker if reachable
const clientId = process.env.KAFKA_CLIENT_ID || 'kafka-ui';
const envBrokers = (process.env.KAFKA_BROKERS || '').split(',').filter(Boolean);
const candidateBrokers = envBrokers.length ? envBrokers : ['kafka:29092', 'localhost:9092'];

let kafkaInstance;
let admin;
let producer;
let selectedBrokers;
let consumer; // lazily created per topic/group
const activeConsumers = new Map(); // Track active consumers

async function pickBrokers() {
  // Try candidates sequentially; first successful connect wins
  for (const brokers of candidateBrokers.map(b => b.split(','))) {
    const k = new Kafka({ clientId, brokers, logLevel: logLevel.ERROR });
    const a = k.admin();
    try {
      // race with timeout
      await Promise.race([
        a.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('connect timeout')), 2500))
      ]);
      await a.disconnect();
      return brokers;
    } catch (_) {
      try { await a.disconnect(); } catch (_) {}
    }
  }
  // Fallback to localhost even if not reachable; errors will surface later
  return envBrokers.length ? envBrokers : ['localhost:9092'];
}

async function ensureInitialized() {
  if (kafkaInstance) return;
  selectedBrokers = await pickBrokers();
  kafkaInstance = new Kafka({ clientId, brokers: selectedBrokers, logLevel: logLevel.ERROR });
  admin = kafkaInstance.admin();
  producer = kafkaInstance.producer();
}

async function ensureConnected() {
  await ensureInitialized();
  await Promise.all([admin.connect(), producer.connect()]);
}

// Create topic
app.post('/api/topics', async (req, res) => {
  const { topic, numPartitions = 1, replicationFactor = 1 } = req.body || {};
  if (!topic) return res.status(400).json({ error: 'topic is required' });
  try {
    await ensureConnected();
    const created = await admin.createTopics({ topics: [{ topic, numPartitions, replicationFactor }], waitForLeaders: true });
    return res.json({ ok: true, created });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// List topics with detailed metadata
app.get('/api/topics', async (_req, res) => {
  try {
    await ensureConnected();
    const topics = await admin.listTopics();
    const metadata = await admin.fetchTopicMetadata({ topics });

    const topicsWithDetails = await Promise.all(
      topics.map(async (topic) => {
        try {
          const offsets = await admin.fetchTopicOffsets(topic);
          const topicMeta = metadata.topics.find(t => t.name === topic);
          const totalMessages = offsets.reduce((sum, partition) => sum + parseInt(partition.high), 0);

          return {
            name: topic,
            partitions: topicMeta?.partitions?.length || 0,
            replicas: topicMeta?.partitions?.[0]?.replicas?.length || 0,
            totalMessages,
            offsets
          };
        } catch (err) {
          return {
            name: topic,
            partitions: 0,
            replicas: 0,
            totalMessages: 0,
            error: err.message
          };
        }
      })
    );

    return res.json({ topics: topicsWithDetails });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get consumer groups
app.get('/api/consumer-groups', async (_req, res) => {
  try {
    await ensureConnected();
    const groups = await admin.listGroups();

    const groupsWithDetails = await Promise.all(
      groups.groups.map(async (group) => {
        try {
          const description = await admin.describeGroups([group.groupId]);
          const offsets = await admin.fetchOffsets({ groupId: group.groupId });

          return {
            groupId: group.groupId,
            protocolType: group.protocolType,
            state: description.groups[0]?.state,
            members: description.groups[0]?.members?.length || 0,
            coordinator: description.groups[0]?.coordinator,
            offsets: offsets.map(offset => ({
              topic: offset.topic,
              partition: offset.partition,
              offset: offset.offset,
              metadata: offset.metadata
            }))
          };
        } catch (err) {
          return {
            groupId: group.groupId,
            protocolType: group.protocolType,
            error: err.message
          };
        }
      })
    );

    return res.json({ groups: groupsWithDetails });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get cluster info and health
app.get('/api/cluster/health', async (_req, res) => {
  try {
    await ensureConnected();
    const cluster = await admin.describeCluster();

    // Simplified health check - removed problematic describeConfigs call
    const brokerHealths = await Promise.all(
      cluster.brokers.map(async (broker) => {
        try {
          const testKafka = new Kafka({
            clientId: 'health-check',
            brokers: [`${broker.host}:${broker.port}`],
            connectionTimeout: 3000,
            requestTimeout: 3000
          });
          const testAdmin = testKafka.admin();
          await testAdmin.connect();
          // Simple health check - just try to list topics
          await testAdmin.listTopics();
          await testAdmin.disconnect();
          return { ...broker, healthy: true };
        } catch (err) {
          return { ...broker, healthy: false, error: err.message };
        }
      })
    );

    return res.json({
      clusterId: cluster.clusterId,
      controller: cluster.controller,
      brokers: brokerHealths
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Basic info
app.get('/api/info', async (_req, res) => {
  try {
    await ensureInitialized();
    return res.json({ brokers: selectedBrokers, clientId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Topic metadata and offsets
app.get('/api/topics/:topic/offsets', async (req, res) => {
  const { topic } = req.params;
  try {
    await ensureConnected();
    const offsets = await admin.fetchTopicOffsets(topic);
    const metadata = await admin.fetchTopicMetadata({ topics: [topic] });

    return res.json({
      topic,
      offsets,
      metadata: metadata.topics[0],
      totalMessages: offsets.reduce((sum, partition) => sum + parseInt(partition.high), 0)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Consumer group offsets and lag
app.get('/api/consumer-groups/:groupId/offsets', async (req, res) => {
  const { groupId } = req.params;
  try {
    await ensureConnected();
    const groupOffsets = await admin.fetchOffsets({ groupId });

    const offsetsWithLag = await Promise.all(
      groupOffsets.map(async (groupOffset) => {
        try {
          const topicOffsets = await admin.fetchTopicOffsets(groupOffset.topic);
          const partitionOffset = topicOffsets.find(to => to.partition === groupOffset.partition);
          const lag = partitionOffset ? parseInt(partitionOffset.high) - parseInt(groupOffset.offset) : 0;

          return {
            ...groupOffset,
            highWaterMark: partitionOffset?.high,
            lag: Math.max(0, lag)
          };
        } catch (err) {
          return {
            ...groupOffset,
            error: err.message,
            lag: 0
          };
        }
      })
    );

    return res.json({ groupId, offsets: offsetsWithLag });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete topic
app.delete('/api/topics/:topic', async (req, res) => {
  const { topic } = req.params;
  try {
    await ensureConnected();
    await admin.deleteTopics({ topics: [topic], timeout: 30000 });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create more partitions
app.post('/api/topics/:topic/partitions', async (req, res) => {
  const { topic } = req.params;
  const { count } = req.body || {};
  const totalCount = Number(count);
  if (!Number.isInteger(totalCount) || totalCount < 1) {
    return res.status(400).json({ error: 'count must be a positive integer' });
  }
  try {
    await ensureConnected();
    await admin.createPartitions({ topicPartitions: [{ topic, count: totalCount }] });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Metadata
app.get('/api/metadata', async (req, res) => {
  const { topic } = req.query;
  try {
    await ensureConnected();
    const md = await admin.describeCluster();
    const result = { clusterId: md.clusterId, controller: md.controller, brokers: md.brokers };
    if (topic) {
      const tm = await admin.fetchTopicMetadata({ topics: [String(topic)] });
      result.topicMetadata = tm.topics?.[0];
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Produce message
app.post('/api/produce', async (req, res) => {
  const { topic, message, key, partition } = req.body || {};
  if (!topic || typeof message === 'undefined') {
    return res.status(400).json({ error: 'topic and message are required' });
  }
  try {
    await ensureConnected();
    const messagePayload = { key, value: String(message) };
    if (partition !== undefined) {
      messagePayload.partition = parseInt(partition);
    }

    const result = await producer.send({ topic, messages: [messagePayload] });
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// SSE consumer stream
app.get('/api/consume', async (req, res) => {
  const { topic, groupId = 'kafka-ui-group', fromBeginning = 'true', autoCommit = 'true' } = req.query;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const consumerId = `${groupId}-${topic}-${Date.now()}`;

  try {
    await ensureConnected();
    consumer = kafkaInstance.consumer({ groupId: String(groupId) });
    activeConsumers.set(consumerId, consumer);

    await consumer.connect();
    await consumer.subscribe({ topic: String(topic), fromBeginning: String(fromBeginning) !== 'false' });

    sendEvent({ type: 'connected', consumerId, topic, groupId });

    await consumer.run({
      autoCommit: String(autoCommit) !== 'false',
      eachMessage: async ({ topic, partition, message }) => {
        sendEvent({
          type: 'message',
          topic,
          partition,
          key: message.key?.toString(),
          value: message.value?.toString(),
          offset: message.offset,
          timestamp: message.timestamp,
          headers: message.headers ? Object.fromEntries(
            Object.entries(message.headers).map(([k, v]) => [k, v.toString()])
          ) : {}
        });
      }
    });

  } catch (err) {
    sendEvent({ type: 'error', error: err.message });
  }

  req.on('close', async () => {
    try {
      const consumerToClose = activeConsumers.get(consumerId);
      if (consumerToClose) {
        await consumerToClose.disconnect();
        activeConsumers.delete(consumerId);
      }
    } catch (err) {
      console.error('Error closing consumer:', err);
    }
  });
});

// Reset consumer group offsets
app.post('/api/consumer-groups/:groupId/reset-offsets', async (req, res) => {
  const { groupId } = req.params;
  const { topic, partition, offset } = req.body || {};

  try {
    await ensureConnected();

    if (topic && partition !== undefined && offset !== undefined) {
      await admin.resetOffsets({
        groupId,
        topic,
        partitions: [{ partition: parseInt(partition), offset: offset.toString() }]
      });
    } else if (topic) {
      // Reset all partitions to earliest
      const topicOffsets = await admin.fetchTopicOffsets(topic);
      const partitions = topicOffsets.map(p => ({
        partition: p.partition,
        offset: p.low
      }));
      await admin.resetOffsets({ groupId, topic, partitions });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get broker configs
app.get('/api/brokers/:brokerId/config', async (req, res) => {
  const { brokerId } = req.params;
  try {
    await ensureConnected();
    const configs = await admin.describeConfigs({
      resources: [{ type: 4, name: brokerId }] // BROKER = 4
    });
    return res.json({ brokerId, configs: configs.resources[0]?.configEntries || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  try {
    // Close all active consumers
    for (const consumer of activeConsumers.values()) {
      await consumer.disconnect();
    }
    activeConsumers.clear();

    if (producer) await producer.disconnect();
    if (admin) await admin.disconnect();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kafka UI server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to view the interface`);
});
