const razorpay = require('../config/razorpay');
const crypto = require('crypto');
const { Wallet, Transaction, Payment } = require('../models');
const { getDiscount } = require('../services/discountService');

exports.getBalance = async (req, res) => {
  try {
    const uid = req.user.uid;
    let wallet = await Wallet.findOne({ where: { uid } });
    if (!wallet) {
      wallet = await Wallet.create({ uid, balance: 0.00 });
    }
    res.json({ balance: wallet.balance });
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.addMoney = async (req, res) => {
  try {
    const { amount } = req.body;
    const uid = req.user.uid; 
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    let wallet = await Wallet.findOne({ where: { uid } });
    if (!wallet) {
      wallet = await Wallet.create({ uid, balance: 0.00 });
    }

    const options = {
      amount: amount * 100,
      currency: 'INR',
      receipt: `receipt_${Date.now()}`
    };
    
    const order = await razorpay.orders.create(options);

    const transaction = await Transaction.create({
      user_id: uid,
      wallet_id: wallet.id,
      type: 'CREDIT',
      amount: amount,
      status: 'PENDING',
      description: 'Add money to wallet',
      is_wallet_txn: true
    });

    await Payment.create({
      transaction_id: transaction.id,
      razorpay_order_id: order.id,
      amount: amount,
      status: 'CREATED',
    });

    res.json({ order, transaction_id: transaction.id });
  } catch (error) {
    console.error('Error adding money:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.calculateBill = async (req, res) => {
  try {
    const { mode } = req.query;
    const uid = req.user.uid;

    let basePrice = 199;
    if (mode === 'voice') basePrice = 220;
    if (mode === 'video') basePrice = 250;

    const discount = await getDiscount(mode, uid);
    const totalToPay = Math.max(0, basePrice - discount);

    res.json({ basePrice, discount, totalToPay });
  } catch (error) {
    console.error('Error calculating bill:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.paySession = async (req, res) => {
  try {
    const { mode, useWallet } = req.body;
    const uid = req.user.uid;

    let basePrice = 199;
    if (mode === 'voice') basePrice = 220;
    if (mode === 'video') basePrice = 250;

    const discount = await getDiscount(mode, uid);
    const totalToPay = Math.max(0, basePrice - discount);

    let wallet = await Wallet.findOne({ where: { uid } });
    if (!wallet) {
      wallet = await Wallet.create({ uid, balance: 0.00 });
    }

    const walletBalance = parseFloat(wallet.balance);
    const walletDeductable = useWallet ? Math.min(walletBalance, totalToPay) : 0;
    const finalAmount = totalToPay - walletDeductable;

    if (finalAmount > 0) {
      // Create Razorpay order
      const options = {
        amount: finalAmount * 100,
        currency: 'INR',
        receipt: `session_${Date.now()}`
      };
      const order = await razorpay.orders.create(options);

      const transaction = await Transaction.create({
        user_id: uid,
        wallet_id: wallet.id,
        type: 'DEBIT',
        amount: totalToPay,
        status: 'PENDING',
        description: `Paid for ${mode} session (via Razorpay)`,
        is_wallet_txn: false // Not fully paid by wallet
      });

      await Payment.create({
        transaction_id: transaction.id,
        razorpay_order_id: order.id,
        amount: finalAmount,
        status: 'CREATED',
      });

      return res.json({ order, transaction_id: transaction.id });
    } else {
      // Fully covered by wallet
      const newBalance = walletBalance - totalToPay;
      await wallet.update({ balance: newBalance });

      const transaction = await Transaction.create({
        user_id: uid,
        wallet_id: wallet.id,
        type: 'DEBIT',
        amount: totalToPay,
        status: 'SUCCESS',
        description: `Paid for ${mode} session (via Wallet)`,
        is_wallet_txn: true
      });

      return res.json({ success: true, transaction_id: transaction.id });
    }
  } catch (error) {
    console.error('Error paying for session:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, transaction_id } = req.body;
    
    const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
    hmac.update(razorpay_order_id + '|' + razorpay_payment_id);
    const generated_signature = hmac.digest('hex');

    if (generated_signature !== razorpay_signature) {
      await Transaction.update({ status: 'FAILED' }, { where: { id: transaction_id } });
      await Payment.update({ status: 'FAILED', razorpay_payment_id, razorpay_signature }, { where: { transaction_id } });
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const payment = await Payment.findOne({ where: { transaction_id } });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const transaction = await Transaction.findByPk(transaction_id);
    const wallet = await Wallet.findByPk(transaction.wallet_id);

    await payment.update({ status: 'CAPTURED', razorpay_payment_id, razorpay_signature });
    await transaction.update({ status: 'SUCCESS' });
    
    const currentBalance = parseFloat(wallet.balance);
    if (transaction.type === 'CREDIT') {
      // Added money
      await wallet.update({ balance: currentBalance + parseFloat(transaction.amount) });
    } else if (transaction.type === 'DEBIT') {
      // Session payment where wallet might have been partially used
      const walletDeduction = parseFloat(transaction.amount) - parseFloat(payment.amount);
      if (walletDeduction > 0) {
        await wallet.update({ balance: currentBalance - walletDeduction });
      }
    }

    res.json({ success: true, balance: parseFloat(wallet.balance) });
  } catch (error) {
    console.error('Error verifying payment:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.linkSession = async (req, res) => {
  try {
    const { transaction_id, session_id } = req.body;
    if (!transaction_id || !session_id) {
      return res.status(400).json({ error: 'Missing parameters' });
    }
    
    await Transaction.update(
      { session_id },
      { where: { id: transaction_id } }
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error linking session:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const uid = req.user.uid;
    
    const wallet = await Wallet.findOne({ where: { uid } });
    if (!wallet) {
      return res.json([]);
    }

    const transactions = await Transaction.findAll({
      where: { wallet_id: wallet.id },
      order: [['created_at', 'DESC']]
    });

    res.json(transactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
