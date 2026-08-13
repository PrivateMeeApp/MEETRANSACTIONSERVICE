const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const authMiddleware = require('../middlewares/auth');

router.use(authMiddleware);

router.get('/balance', walletController.getBalance);
router.post('/add-money', walletController.addMoney);
router.post('/verify-payment', walletController.verifyPayment);
router.get('/transactions', walletController.getTransactions);

// Session billing endpoints
router.get('/calculate-bill', walletController.calculateBill);
router.post('/pay-session', walletController.paySession);
router.post('/verify-session-payment', walletController.verifyPayment); // Reusing verifyPayment
router.post('/link-session', walletController.linkSession);

module.exports = router;
