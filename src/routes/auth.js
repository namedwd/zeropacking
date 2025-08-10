// auth.js - 인증 라우터
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { generateToken, supabase } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * 작업자 간단 로그인 (회사 선택 없음)
 */
router.post('/worker/login-simple', async (req, res) => {
    try {
        const { username, password } = req.body;

        // 입력 검증
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        logger.info(`Login attempt for worker: ${username}`);

        // 작업자 계정 조회 (회사 정보 포함)
        const { data: workers, error: fetchError } = await supabase
            .from('worker_accounts')
            .select(`
                id,
                username,
                password_hash,
                worker_name,
                worker_code,
                department,
                company_id,
                is_active,
                companies (
                    id,
                    name
                )
            `)
            .eq('username', username)
            .eq('is_active', true)
            .single();

        if (fetchError || !workers) {
            logger.error('Worker not found:', username);
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // 비밀번호 검증
        const validPassword = await bcrypt.compare(password, workers.password_hash);
        
        if (!validPassword) {
            logger.error('Invalid password for worker:', username);
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // JWT 토큰 생성
        const token = generateToken({
            worker_id: workers.id,
            worker_name: workers.worker_name,
            username: workers.username,
            company_id: workers.company_id,
            company_name: workers.companies.name,
            department: workers.department,
            type: 'worker'
        });

        // 마지막 로그인 시간 업데이트
        await supabase
            .from('worker_accounts')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', workers.id);

        logger.info(`Worker ${username} logged in successfully from company ${workers.companies.name}`);

        res.json({
            success: true,
            token,
            worker: {
                id: workers.id,
                name: workers.worker_name,
                username: workers.username,
                company_id: workers.company_id,
                company_name: workers.companies.name,
                department: workers.department,
                worker_code: workers.worker_code
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * 작업자 로그인 (기존 - 하위 호환성)
 */
router.post('/worker/login', async (req, res) => {
    try {
        const { company_id, username, password } = req.body;

        // 입력 검증
        if (!company_id || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Company ID, username and password are required'
            });
        }

        logger.info(`Login attempt for worker: ${username} from company: ${company_id}`);

        // RPC 함수 호출로 인증
        const { data, error } = await supabase.rpc('authenticate_worker', {
            p_company_id: company_id,
            p_username: username,
            p_password: password
        });

        if (error) {
            logger.error('Authentication RPC error:', error);
            return res.status(401).json({
                success: false,
                error: 'Authentication failed'
            });
        }

        if (!data || data.length === 0) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        const worker = data[0];

        // JWT 토큰 생성
        const token = generateToken({
            worker_id: worker.worker_id,
            worker_name: worker.worker_name,
            username: username,
            company_id: company_id,
            company_name: worker.company_name,
            department: worker.department,
            type: 'worker'
        });

        // 마지막 로그인 시간 업데이트
        await supabase
            .from('worker_accounts')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', worker.worker_id);

        logger.info(`Worker ${username} logged in successfully`);

        res.json({
            success: true,
            token,
            worker: {
                id: worker.worker_id,
                name: worker.worker_name,
                username: username,
                company_id: company_id,
                company_name: worker.company_name,
                department: worker.department,
                worker_code: worker.worker_code
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * 토큰 검증
 */
router.post('/verify', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({
                success: false,
                error: 'Token is required'
            });
        }

        // JWT 검증
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret-key');

        res.json({
            success: true,
            valid: true,
            user: decoded
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.json({
                success: true,
                valid: false,
                error: error.message
            });
        }

        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * 회사 목록 조회 (공개)
 */
router.get('/companies', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('companies')
            .select('id, name')
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        res.json({
            success: true,
            companies: data
        });

    } catch (error) {
        logger.error('Get companies error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch companies'
        });
    }
});

/**
 * 관리자 로그인 (나중에 구현)
 */
router.post('/admin/login', async (req, res) => {
    res.status(501).json({
        success: false,
        error: 'Admin login not implemented yet'
    });
});

module.exports = router;
