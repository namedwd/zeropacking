// recording.js - 녹화 관련 라우터
const express = require('express');
const router = express.Router();
const { authenticateToken, supabase } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * 녹화 시작
 */
router.post('/start', authenticateToken, async (req, res) => {
    try {
        const { barcode, worker_id, company_id } = req.body;

        // 입력 검증
        if (!barcode) {
            return res.status(400).json({
                success: false,
                error: 'Barcode is required'
            });
        }

        // 토큰에서 가져온 정보 사용 (보안)
        const actualWorkerId = req.user.worker_id;
        const actualCompanyId = req.user.company_id;

        logger.info(`Recording started - Worker: ${actualWorkerId}, Barcode: ${barcode}`);

        // 녹화 레코드 생성
        const { data, error } = await supabase
            .from('recordings')
            .insert({
                company_id: actualCompanyId,
                worker_id: actualWorkerId,
                barcode: barcode,
                start_time: new Date().toISOString(),
                status: 'recording'
            })
            .select()
            .single();

        if (error) {
            logger.error('Failed to create recording record:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to start recording'
            });
        }

        res.json({
            success: true,
            recording_id: data.id,
            message: 'Recording started successfully'
        });

    } catch (error) {
        logger.error('Start recording error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 녹화 종료
 */
router.post('/end', authenticateToken, async (req, res) => {
    try {
        const { recording_id, duration_seconds, file_size_bytes } = req.body;

        if (!recording_id) {
            return res.status(400).json({
                success: false,
                error: 'Recording ID is required'
            });
        }

        logger.info(`Recording ended - ID: ${recording_id}, Duration: ${duration_seconds}s`);

        // 녹화 레코드 업데이트
        const { data, error } = await supabase
            .from('recordings')
            .update({
                end_time: new Date().toISOString(),
                duration_seconds: duration_seconds || 0,
                file_size_bytes: file_size_bytes || 0,
                status: 'uploading',
                updated_at: new Date().toISOString()
            })
            .eq('id', recording_id)
            .eq('worker_id', req.user.worker_id) // 보안: 자신의 녹화만 수정 가능
            .select()
            .single();

        if (error) {
            logger.error('Failed to update recording record:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to end recording'
            });
        }

        res.json({
            success: true,
            recording: data,
            message: 'Recording ended successfully'
        });

    } catch (error) {
        logger.error('End recording error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 업로드 완료 처리
 */
router.post('/upload-complete', authenticateToken, async (req, res) => {
    try {
        const { 
            recording_id, 
            cloud_url, 
            cloud_provider = 'cloudinary',
            thumbnail_url,
            metadata 
        } = req.body;

        if (!recording_id || !cloud_url) {
            return res.status(400).json({
                success: false,
                error: 'Recording ID and cloud URL are required'
            });
        }

        logger.info(`Upload completed - Recording: ${recording_id}`);

        // 녹화 레코드 업데이트
        const updateData = {
            cloud_url: cloud_url,
            cloud_provider: cloud_provider,
            status: 'completed',
            updated_at: new Date().toISOString()
        };

        if (thumbnail_url) {
            updateData.thumbnail_url = thumbnail_url;
        }

        if (metadata) {
            updateData.metadata = metadata;
        }

        const { data, error } = await supabase
            .from('recordings')
            .update(updateData)
            .eq('id', recording_id)
            .eq('worker_id', req.user.worker_id)
            .select()
            .single();

        if (error) {
            logger.error('Failed to update recording with upload info:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update recording'
            });
        }

        res.json({
            success: true,
            recording: data,
            message: 'Upload completed successfully'
        });

    } catch (error) {
        logger.error('Upload complete error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 녹화 목록 조회
 */
router.get('/list', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 20, barcode, status } = req.query;
        const offset = (page - 1) * limit;

        let query = supabase
            .from('recordings')
            .select('*', { count: 'exact' })
            .eq('company_id', req.user.company_id)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        // 필터 적용
        if (barcode) {
            query = query.ilike('barcode', `%${barcode}%`);
        }

        if (status) {
            query = query.eq('status', status);
        }

        const { data, error, count } = await query;

        if (error) {
            logger.error('Failed to fetch recordings:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch recordings'
            });
        }

        res.json({
            success: true,
            recordings: data,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: count,
                totalPages: Math.ceil(count / limit)
            }
        });

    } catch (error) {
        logger.error('List recordings error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 녹화 상세 조회
 */
router.get('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('recordings')
            .select(`
                *,
                worker:worker_accounts(worker_name, worker_code),
                company:companies(name)
            `)
            .eq('id', id)
            .eq('company_id', req.user.company_id)
            .single();

        if (error) {
            logger.error('Failed to fetch recording:', error);
            return res.status(404).json({
                success: false,
                error: 'Recording not found'
            });
        }

        res.json({
            success: true,
            recording: data
        });

    } catch (error) {
        logger.error('Get recording error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 녹화 삭제 (soft delete)
 */
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Soft delete - status를 'deleted'로 변경
        const { data, error } = await supabase
            .from('recordings')
            .update({
                status: 'deleted',
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .eq('company_id', req.user.company_id)
            .select()
            .single();

        if (error) {
            logger.error('Failed to delete recording:', error);
            return res.status(404).json({
                success: false,
                error: 'Recording not found or cannot be deleted'
            });
        }

        logger.info(`Recording deleted: ${id}`);

        res.json({
            success: true,
            message: 'Recording deleted successfully',
            recording: data
        });

    } catch (error) {
        logger.error('Delete recording error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
