// auth.js - 인증 미들웨어
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

// Supabase 클라이언트
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

/**
 * JWT 토큰 생성
 */
function generateToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET || 'default-secret-key', {
        expiresIn: '24h'
    });
}

/**
 * JWT 토큰 검증 미들웨어
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ 
            success: false, 
            error: 'Access token required' 
        });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ 
                success: false, 
                error: 'Invalid or expired token' 
            });
        }
        req.user = user;
        next();
    });
}

/**
 * 선택적 인증 (인증 없어도 통과, 있으면 유저 정보 추가)
 */
function optionalAuth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return next();
    }

    jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key', (err, user) => {
        if (!err) {
            req.user = user;
        }
        next();
    });
}

/**
 * 회사 권한 검증
 */
async function verifyCompanyAccess(req, res, next) {
    try {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Authentication required' 
            });
        }

        const { company_id } = req.params;
        
        if (req.user.company_id !== company_id) {
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied to this company' 
            });
        }

        next();
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
}

module.exports = {
    generateToken,
    authenticateToken,
    optionalAuth,
    verifyCompanyAccess,
    supabase
};
