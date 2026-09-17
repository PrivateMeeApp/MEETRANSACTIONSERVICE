const { sequelize } = require('../config/db');
const Wallet = require('./Wallet');
const Transaction = require('./Transaction');
const Payment = require('./Payment');

module.exports = {
  sequelize,
  Wallet,
  Transaction,
  Payment,
};
