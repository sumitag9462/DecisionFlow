const crypto = require('node:crypto');
const { AppError } = require('../domain/errors');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: JWT_SECRET environment variable is required in production.');
  }
  JWT_SECRET = 'decisionflow-development-secret-key-32chars';
}

// Demo users database with scrypt password hashes
const DEMO_USERS = [
  {
    id: 'usr-admin-01',
    email: 'admin@decisionflow.io',
    name: 'Alice Admin',
    role: 'ADMIN',
    // Salt + Hash for password 'Admin@123'
    salt: 'salt-admin-1234',
    passwordHash: hashPassword('Admin@123', 'salt-admin-1234')
  },
  {
    id: 'usr-reviewer-01',
    email: 'reviewer@decisionflow.io',
    name: 'Bob Reviewer',
    role: 'REVIEWER',
    // Salt + Hash for password 'Reviewer@123'
    salt: 'salt-reviewer-1234',
    passwordHash: hashPassword('Reviewer@123', 'salt-reviewer-1234')
  },
  {
    id: 'usr-viewer-01',
    email: 'viewer@decisionflow.io',
    name: 'Charlie Viewer',
    role: 'VIEWER',
    // Salt + Hash for password 'Viewer@123'
    salt: 'salt-viewer-1234',
    passwordHash: hashPassword('Viewer@123', 'salt-viewer-1234')
  }
];

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString('hex');
}

function createToken(user, expiresInSec = 86400) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    iat: now,
    exp: now + expiresInSec
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') throw new AppError(401, 'UNAUTHORIZED', 'Missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError(401, 'UNAUTHORIZED', 'Malformed token format');
  const [header, payload, signature] = parts;

  let decodedHeader;
  try {
    decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid token header');
  }

  if (!decodedHeader || decodedHeader.alg !== 'HS256' || decodedHeader.typ !== 'JWT') {
    throw new AppError(401, 'UNAUTHORIZED', 'Unsupported token algorithm or type');
  }

  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid token signature');
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid token payload');
  }

  const now = Math.floor(Date.now() / 1000);
  if (decoded.exp && decoded.exp < now) {
    throw new AppError(401, 'TOKEN_EXPIRED', 'Token has expired');
  }
  return decoded;
}

function authenticate(req, _res, next) {
  const authHeader = req.get('Authorization') || '';
  let token = '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  }

  // Security: X-Demo-Role header is completely removed and ignored to prevent privilege spoofing.
  if (!token) {
    req.user = null;
    return next();
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

function requireAuth(req, _res, next) {
  if (!req.user) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Authentication token required'));
  }
  next();
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Authentication token required'));
    }
    if (!roles.includes(req.user.role)) {
      return next(new AppError(403, 'FORBIDDEN', `Role ${req.user.role} is not authorized for this operation (requires: ${roles.join(', ')})`));
    }
    next();
  };
}

function login(email, password) {
  if (!email || !password) {
    throw new AppError(400, 'INVALID_CREDENTIALS', 'Email and password are required');
  }
  const user = DEMO_USERS.find(u => u.email.toLowerCase() === email.toLowerCase().trim());
  if (!user) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const hash = hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const token = createToken(user);
  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  };
}

module.exports = {
  createToken,
  verifyToken,
  authenticate,
  requireAuth,
  requireRole,
  login,
  DEMO_USERS
};
