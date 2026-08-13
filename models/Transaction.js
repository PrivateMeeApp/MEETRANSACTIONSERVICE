const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Wallet = require('./Wallet');

const Transaction = sequelize.define('Transaction', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  expert_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  session_id: {
    type: DataTypes.UUID,
    allowNull: true,
  },
  wallet_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM('CREDIT', 'DEBIT', 'REFUND'),
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'),
    allowNull: false,
    defaultValue: 'PENDING',
  },
  description: {
    type: DataTypes.STRING(255),
  },
  is_wallet_txn: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  }
}, {
  tableName: 'transactions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
});

Transaction.belongsTo(Wallet, { foreignKey: 'wallet_id' });
Wallet.hasMany(Transaction, { foreignKey: 'wallet_id' });

module.exports = Transaction;
