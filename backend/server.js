require('dotenv').config();
const mongoose = require('mongoose');
const { loadPolicies } = require('./src/config/loadPolicies');
const { MongoRepository } = require('./src/persistence/MongoRepository');
const RequestModel = require('./src/persistence/RequestModel');
const { createDecisionService } = require('./src/services/decisionService');
const { createApp } = require('./src/http/createApp');

async function main() {
  const policies = loadPolicies();
  const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/decisionflow';
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  await RequestModel.init(); // ensure unique index is ready before accepting requests

  const service = createDecisionService({ repo: new MongoRepository(), policies });
  const app = createApp(service, { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' });
  const port = Number(process.env.PORT) || 3001;
  const host = process.env.HOST || '127.0.0.1';
  const server = app.listen(port, host, () => {
    console.log(`DecisionFlow API at http://${host}:${port}`);
    console.log(`Loaded ${policies.size} workflow configs`);
  });
  const stop = async () => {
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch(err => {
  if (err.message && (err.message.includes('ECONNREFUSED') || err.message.includes('Server selection timed out'))) {
    console.error('\n[DecisionFlow] Database connection failed.');
    console.error('Check MONGO_URI, network access, and database credentials.');
    console.error('Ensure MongoDB is installed and running:');
    console.error('  macOS: mongod --config /opt/homebrew/etc/mongod.conf');
    console.error('  Linux: sudo systemctl start mongod\n');
  } else {
    console.error('[DecisionFlow] Server startup failed:', err.message);
  }
  process.exit(1);
});
