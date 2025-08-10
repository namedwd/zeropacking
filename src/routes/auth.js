// src/routes/auth.js - 인증 라우트
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { generateToken } = require('../middleware/auth');
const supabase = require('../config/database');
const logger = require('../utils/logger');

/**
 * 작업자 로그인
 * POST /api/auth/worker/login
 */
router.post('/worker/login', async (req, res) => {
    try {
        const { company_id, username, password } = req.body;

        // 입력 검증
        if (!company_id || !username || !password) {
            return res.status(400).json({ 
                error: 'Company ID, username, and password are required' 
            });
        }

        // Supabase RPC 함수 호출
        const { data, error } = await supabase.rpc('authenticate_worker', {
            p_company_id: company_id,
            p_username: username,
            p_password: password
        });

        if (error) {
            logger.error('Worker authentication error:', error);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!data || data.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const workerData = data[0];

        // JWT 토큰 생성
        const token = generateToken({
            worker_id: workerData.worker_id,
            company_id: company_id,
            worker_name: workerData.worker_name,
            company_name: workerData.company_name,
            type: 'worker'
        });

        // 응답
        res.json({
            success: true,
            token,
            worker: {
                worker_id: workerData.worker_id,
                worker_name: workerData.worker_name,
                company_name: workerData.company_name,
                company_id: company_id
            }
        });

        logger.info(`Worker logged in: ${username} from company ${workerData.company_name}`);

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

/**
 * 토큰 검증
 * POST /api/auth/verify
 */
router.post('/verify', async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        const jwt = require('jsonwebtoken');
        
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                return res.status(401).json({ 
                    valid: false, 
                    error: 'Invalid or expired token' 
                });
            }

            res.json({
                valid: true,
                decoded: {
                    worker_id: decoded.worker_id,
                    company_id: decoded.company_id,
                    worker_name: decoded.worker_name,
                    company_name: decoded.company_name,
                    type: decoded.type
                }
            });
        });

    } catch (error) {
        logger.error('Token verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

/**
 * 회사 목록 조회 (로그인 화면용)
 * GET /api/auth/companies
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
        logger.error('Error fetching companies:', error);
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});

/**
 * 작업자 계정 생성 (관리자용)
 * POST /api/auth/worker/create
 */
router.post('/worker/create', async (req, res) => {
    try {
        const { company_id, username, password, worker_name, worker_code, department } = req.body;

        // 입력 검증
        if (!company_id || !username || !password || !worker_name) {
            return res.status(400).json({ 
                error: 'Required fields: company_id, username, password, worker_name' 
            });
        }

        // 비밀번호 해시
        const salt = await bcrypt.genSalt(10);
        const password_hash = await bcrypt.hash(password, salt);

        // 작업자 계정 생성
        const { data, error } = await supabase
            .from('worker_accounts')
            .insert({
                company_id,
                username,
                password_hash,
                worker_name,
                worker_code,
                department,
                is_active: true
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique violation
                return res.status(409).json({ error: 'Username already exists for this company' });
            }
            throw error;
        }

        res.json({
            success: true,
            worker: {
                id: data.id,
                username: data.username,
                worker_name: data.worker_name,
                worker_code: data.worker_code
            }
        });

        logger.info(`Worker account created: ${username} for company ${company_id}`);

    } catch (error) {
        logger.error('Error creating worker account:', error);
        res.status(500).json({ error: 'Failed to create worker account' });
    }
});

module.exports = router;
