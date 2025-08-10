// src/routes/recording.js - 녹화 관련 라우트
const express = require('express');
const router = express.Router();
const { authenticateWorker } = require('../middleware/auth');
const supabase = require('../config/database');
const logger = require('../utils/logger');

/**
 * 녹화 시작
 * POST /api/recording/start
 */
router.post('/start', authenticateWorker, async (req, res) => {
    try {
        const { barcode, resolution, fps } = req.body;
        const { worker_id } = req.worker;

        if (!barcode) {
            return res.status(400).json({ error: 'Barcode is required' });
        }

        // RPC 함수 호출
        const { data, error } = await supabase.rpc('start_recording', {
            p_worker_id: worker_id,
            p_barcode: barcode,
            p_resolution: resolution || '1920x1080',
            p_fps: fps || 30
        });

        if (error) {
            if (error.message.includes('already in progress')) {
                return res.status(409).json({ error: 'Recording already in progress for this barcode' });
            }
            throw error;
        }

        res.json({
            success: true,
            recording_id: data,
            barcode,
            status: 'recording'
        });

        logger.info(`Recording started: ${data} for barcode ${barcode}`);

    } catch (error) {
        logger.error('Error starting recording:', error);
        res.status(500).json({ error: 'Failed to start recording' });
    }
});

/**
 * 녹화 종료
 * POST /api/recording/end
 */
router.post('/end', authenticateWorker, async (req, res) => {
    try {
        const { recording_id, file_size_bytes, cloud_url } = req.body;

        if (!recording_id) {
            return res.status(400).json({ error: 'Recording ID is required' });
        }

        // RPC 함수 호출
        const { data, error } = await supabase.rpc('end_recording', {
            p_recording_id: recording_id,
            p_file_size_bytes: file_size_bytes || null,
            p_cloud_url: cloud_url || null
        });

        if (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({ error: 'Recording not found or already ended' });
            }
            throw error;
        }

        res.json({
            success: true,
            recording_id,
            status: cloud_url ? 'completed' : 'uploading'
        });

        logger.info(`Recording ended: ${recording_id}`);

    } catch (error) {
        logger.error('Error ending recording:', error);
        res.status(500).json({ error: 'Failed to end recording' });
    }
});

/**
 * 녹화 상태 업데이트
 * PATCH /api/recording/:id/status
 */
router.patch('/:id/status', authenticateWorker, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, cloud_url, error_message } = req.body;
        const { worker_id } = req.worker;

        // 권한 확인
        const { data: recording, error: fetchError } = await supabase
            .from('recordings')
            .select('worker_id')
            .eq('id', id)
            .single();

        if (fetchError || !recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        if (recording.worker_id !== worker_id) {
            return res.status(403).json({ error: 'Unauthorized to update this recording' });
        }

        // 상태 업데이트
        const updateData = {
            status,
            updated_at: new Date().toISOString()
        };

        if (cloud_url) updateData.cloud_url = cloud_url;
        if (error_message) updateData.error_message = error_message;

        const { error: updateError } = await supabase
            .from('recordings')
            .update(updateData)
            .eq('id', id);

        if (updateError) throw updateError;

        res.json({
            success: true,
            recording_id: id,
            status
        });

    } catch (error) {
        logger.error('Error updating recording status:', error);
        res.status(500).json({ error: 'Failed to update recording status' });
    }
});

/**
 * 녹화 목록 조회
 * GET /api/recording/list
 */
router.get('/list', authenticateWorker, async (req, res) => {
    try {
        const { worker_id, company_id } = req.worker;
        const { limit = 20, offset = 0, barcode, status } = req.query;

        let query = supabase
            .from('recordings')
            .select('*')
            .eq('company_id', company_id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // 필터 적용
        if (barcode) query = query.eq('barcode', barcode);
        if (status) query = query.eq('status', status);

        const { data, error, count } = await query;

        if (error) throw error;

        res.json({
            success: true,
            recordings: data,
            total: count,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });

    } catch (error) {
        logger.error('Error fetching recordings:', error);
        res.status(500).json({ error: 'Failed to fetch recordings' });
    }
});

module.exports = router;
