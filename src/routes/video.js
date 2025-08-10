// src/routes/video.js - 영상 스트리밍 라우트
const express = require('express');
const router = express.Router();
const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const supabase = require('../config/database');
const logger = require('../utils/logger');
const { authenticateWorker } = require('../middleware/auth');

// S3 클라이언트
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

/**
 * 영상 재생 URL 생성 (Presigned URL)
 * GET /api/video/url/:recordingId
 * 
 * 가장 효율적인 방법 - S3 직접 스트리밍
 */
router.get('/url/:recordingId', authenticateWorker, async (req, res) => {
    try {
        const { recordingId } = req.params;
        const { company_id } = req.worker;

        // 1. DB에서 녹화 정보 조회
        const { data: recording, error } = await supabase
            .from('recordings')
            .select('*')
            .eq('id', recordingId)
            .eq('company_id', company_id)
            .single();

        if (error || !recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        if (!recording.cloud_url) {
            return res.status(404).json({ error: 'Video file not available' });
        }

        // 2. S3 키 추출 (URL에서)
        const s3Key = recording.cloud_url.split('.amazonaws.com/')[1];

        // 3. Presigned URL 생성 (1시간 유효)
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: s3Key,
            ResponseContentDisposition: `inline; filename="${recording.barcode}.webm"`,
            ResponseContentType: 'video/webm'
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: 3600 // 1시간
        });

        // 4. 메타데이터와 함께 반환
        res.json({
            success: true,
            url: presignedUrl,
            expiresIn: 3600,
            metadata: {
                recordingId: recording.id,
                barcode: recording.barcode,
                duration: recording.duration_seconds,
                fileSize: recording.file_size_bytes,
                resolution: recording.resolution,
                recordedAt: recording.start_time
            }
        });

        logger.info(`Video URL generated for recording ${recordingId}`);

    } catch (error) {
        logger.error('Error generating video URL:', error);
        res.status(500).json({ error: 'Failed to generate video URL' });
    }
});

/**
 * 영상 직접 스트리밍 (Range 지원)
 * GET /api/video/stream/:recordingId
 * 
 * 서버 부하가 높지만 더 많은 제어 가능
 */
router.get('/stream/:recordingId', authenticateWorker, async (req, res) => {
    try {
        const { recordingId } = req.params;
        const { company_id } = req.worker;
        const range = req.headers.range;

        // 1. DB에서 녹화 정보 조회
        const { data: recording, error } = await supabase
            .from('recordings')
            .select('*')
            .eq('id', recordingId)
            .eq('company_id', company_id)
            .single();

        if (error || !recording) {
            return res.status(404).json({ error: 'Recording not found' });
        }

        const s3Key = recording.cloud_url.split('.amazonaws.com/')[1];

        // 2. S3 객체 메타데이터 조회
        const headCommand = new HeadObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: s3Key
        });

        const headData = await s3Client.send(headCommand);
        const videoSize = headData.ContentLength;

        // 3. Range 처리
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : videoSize - 1;
            const chunksize = (end - start) + 1;

            // 4. 부분 데이터 스트리밍
            const getObjectCommand = new GetObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: s3Key,
                Range: `bytes=${start}-${end}`
            });

            const { Body } = await s3Client.send(getObjectCommand);

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${videoSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'video/webm',
                'Cache-Control': 'no-cache'
            });

            Body.pipe(res);
        } else {
            // 5. 전체 파일 스트리밍
            const getObjectCommand = new GetObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: s3Key
            });

            const { Body } = await s3Client.send(getObjectCommand);

            res.writeHead(200, {
                'Content-Length': videoSize,
                'Content-Type': 'video/webm',
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-cache'
            });

            Body.pipe(res);
        }

    } catch (error) {
        logger.error('Error streaming video:', error);
        res.status(500).json({ error: 'Failed to stream video' });
    }
});

/**
 * 영상 목록 with 재생 가능 URL
 * GET /api/video/list
 */
router.get('/list', authenticateWorker, async (req, res) => {
    try {
        const { company_id } = req.worker;
        const { limit = 20, offset = 0, barcode } = req.query;

        // 1. 녹화 목록 조회
        let query = supabase
            .from('recordings')
            .select('*')
            .eq('company_id', company_id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (barcode) {
            query = query.ilike('barcode', `%${barcode}%`);
        }

        const { data: recordings, error } = await query;

        if (error) throw error;

        // 2. 각 영상에 대한 재생 URL 생성
        const recordingsWithUrls = await Promise.all(
            recordings.map(async (recording) => {
                if (!recording.cloud_url) {
                    return { ...recording, playUrl: null };
                }

                const s3Key = recording.cloud_url.split('.amazonaws.com/')[1];
                
                const command = new GetObjectCommand({
                    Bucket: process.env.S3_BUCKET_NAME,
                    Key: s3Key
                });

                const playUrl = await getSignedUrl(s3Client, command, {
                    expiresIn: 3600
                });

                return {
                    ...recording,
                    playUrl
                };
            })
        );

        res.json({
            success: true,
            recordings: recordingsWithUrls,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
                total: recordings.length
            }
        });

    } catch (error) {
        logger.error('Error fetching video list:', error);
        res.status(500).json({ error: 'Failed to fetch video list' });
    }
});

module.exports = router;
