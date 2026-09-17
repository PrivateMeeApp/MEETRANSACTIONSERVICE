require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./config/db');
require('./models'); // initialize models

const walletRoutes = require('./routes/walletRoutes');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/wallet', walletRoutes);

app.get('/', (req, res) => {
  res.send('Transaction Service is running');
});

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully.');
    // Sync models
    await sequelize.sync({ alter: true });
    
    app.listen(PORT, () => {
      console.log(`Transaction service running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Unable to connect to the database:', error);
  }
};

startServer();
