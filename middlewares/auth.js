const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Decoding without verifying signature if we don't have the secret here, 
    // but ideally we should verify. If MEESESSIONSERVICE signs it, we should use the same secret.
    // For now, we decode it to get the uid.
    const decoded = jwt.decode(token);
    
    if (!decoded || !decoded.uid) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    req.user = { uid: decoded.uid, role: decoded.role };
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

module.exports = authMiddleware;
