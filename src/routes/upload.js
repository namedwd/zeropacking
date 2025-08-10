// src/routes/upload.js - S3 업로드 라우트
const express = require('express');
const router = express.Router();
const { S3Client, PutObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const logger = require('../utils/logger');
const { authenticateWorker } = require('../middleware/auth');

// S3 클라이언트 설정
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
});

// 파일 키 생성 함수
function generateFileKey(companyId, barcode, timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `recordings/${companyId}/${year}/${month}/${day}/${barcode}_${timestamp}.webm`;
}

/**
 * 단일 파일 업로드용 Presigned URL 생성
 * POST /api/upload/presigned-url
 */
router.post('/presigned-url', authenticateWorker, async (req, res) => {
    try {
        const { fileName, barcode, fileSize } = req.body;
        const { company_id, worker_id } = req.worker;

        if (!fileName || !barcode) {
            return res.status(400).json({ error: 'fileName and barcode are required' });
        }

        // 파일 크기 체크 (최대 100MB for single upload)
        const maxSizeMB = 100;
        if (fileSize && fileSize > maxSizeMB * 1024 * 1024) {
            return res.status(400).json({ 
                error: `File too large for single upload. Max size: ${maxSizeMB}MB. Use multipart upload instead.` 
            });
        }

        const timestamp = Date.now();
        const key = generateFileKey(company_id, barcode, timestamp);

        // Presigned URL 생성
        const command = new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
            ContentType: 'video/webm',
            Metadata: {
                'company-id': company_id,
                'worker-id': worker_id,
                'barcode': barcode,
                'upload-time': new Date().toISOString()
            }
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: parseInt(process.env.PRESIGNED_URL_EXPIRES_SECONDS) || 3600
        });

        const publicUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

        logger.info(`Presigned URL generated for ${key}`);

        res.json({
            presignedUrl,
            publicUrl,
            key,
            expiresIn: process.env.PRESIGNED_URL_EXPIRES_SECONDS || 3600
        });

    } catch (error) {
        logger.error('Error generating presigned URL:', error);
        res.status(500).json({ error: 'Failed to generate presigned URL' });
    }
});

/**
 * Multipart 업로드 초기화
 * POST /api/upload/multipart/init
 */
router.post('/multipart/init', authenticateWorker, async (req, res) => {
    try {
        const { fileName, barcode, fileSize } = req.body;
        const { company_id, worker_id } = req.worker;

        if (!fileName || !barcode) {
            return res.status(400).json({ error: 'fileName and barcode are required' });
        }

        const timestamp = Date.now();
        const key = generateFileKey(company_id, barcode, timestamp);

        // Multipart 업로드 시작
        const command = new CreateMultipartUploadCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
            ContentType: 'video/webm',
            Metadata: {
                'company-id': company_id,
                'worker-id': worker_id,
                'barcode': barcode,
                'file-size': String(fileSize || 0),
                'upload-time': new Date().toISOString()
            }
        });

        const response = await s3Client.send(command);

        logger.info(`Multipart upload initiated: ${key}, UploadId: ${response.UploadId}`);

        res.json({
            uploadId: response.UploadId,
            key,
            bucket: process.env.S3_BUCKET_NAME
        });

    } catch (error) {
        logger.error('Error initiating multipart upload:', error);
        res.status(500).json({ error: 'Failed to initiate multipart upload' });
    }
});

/**
 * Multipart 파트 업로드용 Presigned URL
 * POST /api/upload/multipart/part-url
 */
router.post('/multipart/part-url', authenticateWorker, async (req, res) => {
    try {
        const { key, uploadId, partNumber } = req.body;

        if (!key || !uploadId || !partNumber) {
            return res.status(400).json({ error: 'key, uploadId, and partNumber are required' });
        }

        // 파트 업로드 커맨드
        const command = new UploadPartCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber
        });

        const presignedUrl = await getSignedUrl(s3Client, command, {
            expiresIn: parseInt(process.env.PRESIGNED_URL_EXPIRES_SECONDS) || 3600
        });

        res.json({
            presignedUrl,
            partNumber
        });

    } catch (error) {
        logger.error('Error generating part presigned URL:', error);
        res.status(500).json({ error: 'Failed to generate part presigned URL' });
    }
});

/**
 * Multipart 업로드 완료
 * POST /api/upload/multipart/complete
 */
router.post('/multipart/complete', authenticateWorker, async (req, res) => {
    try {
        const { key, uploadId, parts } = req.body;

        if (!key || !uploadId || !parts || !Array.isArray(parts)) {
            return res.status(400).json({ error: 'key, uploadId, and parts array are required' });
        }

        // 파트 정렬 (PartNumber 기준)
        const sortedParts = parts.sort((a, b) => a.PartNumber - b.PartNumber);

        // Multipart 업로드 완료
        const command = new CompleteMultipartUploadCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
                Parts: sortedParts
            }
        });

        const response = await s3Client.send(command);

        const publicUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

        logger.info(`Multipart upload completed: ${key}`);

        res.json({
            publicUrl,
            key,
            etag: response.ETag,
            location: response.Location
        });

    } catch (error) {
        logger.error('Error completing multipart upload:', error);
        res.status(500).json({ error: 'Failed to complete multipart upload' });
    }
});

/**
 * Multipart 업로드 취소
 * POST /api/upload/multipart/abort
 */
router.post('/multipart/abort', authenticateWorker, async (req, res) => {
    try {
        const { key, uploadId } = req.body;

        if (!key || !uploadId) {
            return res.status(400).json({ error: 'key and uploadId are required' });
        }

        const command = new AbortMultipartUploadCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: key,
            UploadId: uploadId
        });

        await s3Client.send(command);

        logger.info(`Multipart upload aborted: ${key}, UploadId: ${uploadId}`);

        res.json({
            message: 'Multipart upload aborted successfully',
            key,
            uploadId
        });

    } catch (error) {
        logger.error('Error aborting multipart upload:', error);
        res.status(500).json({ error: 'Failed to abort multipart upload' });
    }
});

module.exports = router;
