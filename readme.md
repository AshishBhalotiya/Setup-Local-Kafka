# 🔄 Kafka Management UI

A comprehensive, containerized Kafka management platform with a modern web interface for managing Apache Kafka clusters. Features real-time monitoring, topic management, message production/consumption, consumer group tracking, and health monitoring with both light and dark themes.

![Kafka Management UI](https://img.shields.io/badge/Kafka-Management-blue) ![Docker](https://img.shields.io/badge/Docker-Compose-blue) ![Node.js](https://img.shields.io/badge/Node.js-20-green) ![Status](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)

## ✨ Features

### 📊 **Overview Dashboard**
- Real-time cluster metrics and statistics
- Total topics, partitions, and message counts
- Active consumer groups monitoring
- Recent topics list with detailed information

### 📝 **Topic Management**
- Create topics with custom partitions and replication factors
- Delete topics with confirmation dialogs
- View detailed topic metadata and partition information
- Real-time topic statistics and offset tracking

### 📤 **Message Producer**
- Send messages to any topic with optional keys
- Support for partition targeting
- Real-time delivery confirmation
- JSON message formatting support

### 📥 **Real-time Consumer**
- Live message consumption with Server-Sent Events (SSE)
- Configurable consumer groups
- From beginning or latest offset options
- Terminal-style message log with timestamps

### 👥 **Consumer Group Monitoring**
- Track all consumer groups and their states
- Monitor member counts and coordinator information
- View offset details and lag tracking
- Consumer group health monitoring

### 🏥 **Cluster Health Monitoring**
- Real-time broker health checks
- Cluster information and controller details
- Health percentage with visual indicators
- Individual broker status monitoring

### 🌙 **Modern UI/UX**
- Light and dark theme toggle with persistence
- Responsive design for desktop and mobile
- Professional toast notifications
- Auto-refresh functionality every 30 seconds

## 🚀 Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Node.js 18+ (for local development)

### 🐳 Docker Setup (Recommended)

1. **Clone and navigate to the project:**
```bash
git clone <repository-url>
cd Kafka
```

2. **Start the complete stack:**
```bash
./start.sh
```

This will:
- Start Zookeeper, Kafka, and the Management UI
- Wait for all services to be healthy
- Provide you with the access URL

3. **Access the UI:**
Open your browser to **http://localhost:3333**

### 🔧 Manual Docker Commands

```bash
# Start all services
docker-compose up --build -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

### 💻 Local Development Setup

```bash
# Install dependencies
npm install

# Set environment variables
export KAFKA_BROKERS=localhost:9092

# Start the UI server
npm start
```

## 📋 Available Services

| Service | URL/Port | Description |
|---------|----------|-------------|
| **Kafka Management UI** | http://localhost:3333 | Web interface for Kafka management |
| **Kafka Broker** | localhost:9092 | Apache Kafka broker |
| **Zookeeper** | localhost:2181 | Zookeeper coordination service |

## 🛠️ Management Commands

### Docker Compose Commands
```bash
# View container status
docker-compose ps

# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs kafka-ui
docker-compose logs kafka
docker-compose logs zookeeper

# Restart specific service
docker-compose restart kafka-ui

# Scale services (if needed)
docker-compose up --scale kafka-ui=2
```

### Health Checks
```bash
# Check UI health
curl http://localhost:3333/api/info

# Check Kafka health
docker exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092

# Check Zookeeper health
docker exec zookeeper nc -z localhost 2181
```

## 🎯 API Endpoints

The UI provides a REST API for programmatic access:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/info` | GET | Broker connection info |
| `/api/topics` | GET | List all topics with metadata |
| `/api/topics` | POST | Create a new topic |
| `/api/topics/:topic` | DELETE | Delete a topic |
| `/api/topics/:topic/offsets` | GET | Get topic offsets and metadata |
| `/api/consumer-groups` | GET | List consumer groups |
| `/api/consumer-groups/:groupId/offsets` | GET | Get group offsets and lag |
| `/api/cluster/health` | GET | Cluster health information |
| `/api/produce` | POST | Produce messages |
| `/api/consume` | GET | Consume messages (SSE stream) |

## 🔧 Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BROKERS` | `kafka:29092` | Kafka broker connection string |
| `KAFKA_CLIENT_ID` | `kafka-ui-docker` | Kafka client identifier |
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `3333` | UI server port |

### Kafka Port Configuration Explained

**Important**: Kafka uses two different ports depending on how you connect:

- **Port 9092**: External access from your host machine (localhost:9092)
- **Port 29092**: Internal Docker network communication (kafka:29092)

When the UI runs in Docker, it uses `kafka:29092` to communicate with Kafka internally.
When you connect from outside Docker (like local development), you use `localhost:9092`.

## 📊 Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Browser   │    │   Kafka UI      │    │     Kafka       │
│   (Port 3333)   │◄──►│  (Node.js)      │◄──►│   (Port 9092)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                        │
                                │                        ▼
                                │               ┌─────────────────┐
                                │               │   Zookeeper     │
                                │               │   (Port 2181)   │
                                │               └─────────────���───┘
                                ▼
                       ┌─────────────────┐
                       │   Docker        │
                       │   Network       │
                       └───────────���─────┘
```

<!-- ::: Code Generated by Copilot 550e8424-e29b-41d4-a716-446655440024. This comment will be removed automatically after the file is saved ::: -->
### Port Mapping Details

**External Access (from your computer):**
- UI: `localhost:3333` → Docker container port 3000
- Kafka: `localhost:9092` → Docker container port 9092

**Internal Docker Network:**
- UI connects to Kafka using: `kafka:29092` (internal network)
- This is why KAFKA_BROKERS=kafka:29092 in docker-compose.yml

**Why two Kafka ports?**
- **9092**: External port for host machine access
- **29092**: Internal Docker network port for container-to-container communication
- Both point to the same Kafka broker, just different network interfaces

## 🚀 Production Deployment

### Docker Swarm
```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml kafka-stack
```

### Kubernetes
Convert using Kompose:
```bash
# Install kompose
curl -L https://github.com/kubernetes/kompose/releases/latest/download/kompose-linux-amd64 -o kompose

# Convert to Kubernetes manifests
kompose convert

# Deploy to Kubernetes
kubectl apply -f .
```

### Security Considerations
- Enable SASL authentication for Kafka
- Use TLS encryption for production
- Implement proper network security
- Regular security updates for containers

## 🔍 Troubleshooting

### Common Issues

**UI not accessible:**
```bash
# Check container status
docker-compose ps

# Check UI logs
docker-compose logs kafka-ui

# Verify port availability
netstat -tulpn | grep 3333
```

**Kafka connection issues:**
```bash
# Test Kafka connectivity
docker exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092

# Check network connectivity
docker exec kafka-ui ping kafka
```

**Container startup issues:**
```bash
# Clean restart
docker-compose down -v
docker-compose up --build -d

# Check resource usage
docker stats
```

### Log Locations
- **Container logs**: `docker-compose logs [service-name]`
- **Kafka logs**: Inside container at `/var/log/kafka/`
- **UI logs**: Stdout/stderr in container

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes
4. Add tests if applicable
5. Commit changes: `git commit -am 'Add feature'`
6. Push to branch: `git push origin feature-name`
7. Submit a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: Report bugs via GitHub Issues
- **Discussions**: Use GitHub Discussions for questions

## 🚀 Roadmap

- [ ] Schema Registry integration
- [ ] Kafka Streams monitoring
- [ ] Multi-cluster support
- [ ] Advanced security features
- [ ] Metrics export (Prometheus)
- [ ] Advanced message filtering
- [ ] Topic configuration management
- [ ] Consumer lag alerting

---

**Built with ❤️ for the Apache Kafka community**
