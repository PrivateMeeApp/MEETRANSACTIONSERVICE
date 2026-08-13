const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Transaction = require('./Transaction');

const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
  },
  transaction_id: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  razorpay_order_id: {
    type: DataTypes.STRING(100),
    unique: true,
  },
  razorpay_payment_id: {
    type: DataTypes.STRING(100),
    unique: true,
  },
  razorpay_signature: {
    type: DataTypes.STRING(255),
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
  },
  status: {
    type: DataTypes.ENUM('CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'),
    allowNull: false,
    defaultValue: 'CREATED',
  },
  method: {
    type: DataTypes.STRING(50),
  }
}, {
  tableName: 'payments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
});

Payment.belongsTo(Transaction, { foreignKey: 'transaction_id' });
Transaction.hasMany(Payment, { foreignKey: 'transaction_id' });

module.exports = Payment;
