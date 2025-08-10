// src/middleware/auth.js - 인증 미들웨어
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * JWT 토큰 생성
 */
function generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });
}

/**
 * JWT 토큰 검증
 */
function verifyToken(token) {
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        logger.error('Token verification failed:', error.message);
        return null;
    }
}

/**
 * 작업자 인증 미들웨어
 */
function authenticateWorker(req, res, next) {
    try {
        // Authorization 헤더에서 토큰 추출
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header' });
        }

        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.slice(7) 
            : authHeader;

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        // 토큰 검증
        const decoded = verifyToken(token);
        
        if (!decoded) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // 작업자 정보를 request에 추가
        req.worker = {
            worker_id: decoded.worker_id,
            company_id: decoded.company_id,
            worker_name: decoded.worker_name,
            company_name: decoded.company_name
        };

        next();
    } catch (error) {
        logger.error('Authentication error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
}

/**
 * 관리자 인증 미들웨어 (선택적)
 */
function authenticateAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header' });
        }

        const token = authHeader.startsWith('Bearer ') 
            ? authHeader.slice(7) 
            : authHeader;

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = verifyToken(token);
        
        if (!decoded || decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        req.admin = {
            admin_id: decoded.admin_id,
            company_id: decoded.company_id,
            email: decoded.email,
            role: decoded.role
        };

        next();
    } catch (error) {
        logger.error('Admin authentication error:', error);
        res.status(401).json({ error: 'Authentication failed' });
    }
}

module.exports = {
    generateToken,
    verifyToken,
    authenticateWorker,
    authenticateAdmin
};
