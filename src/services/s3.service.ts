import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3Service {
  private static _s3Client: S3Client | null = null;

  private static get s3Client(): S3Client {
    if (!this._s3Client) {
      this._s3Client = new S3Client({
        region: process.env.AWS_REGION || "auto",
        endpoint: process.env.AWS_ENDPOINT,
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
        },
      });
    }
    return this._s3Client;
  }

  private static get bucketName(): string {
    return process.env.AWS_S3_BUCKET || "amaz-hospital-lab-reports";
  }

  /**
   * Generates a pre-signed URL for direct upload from the browser to S3.
   * @param filename the desired filename
   * @param contentType the file content type (e.g., application/pdf)
   * @returns an object containing the upload URL and the final file URL
   */
  public static async generateUploadUrl(filename: string, contentType: string) {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      console.warn("AWS credentials missing. S3 upload URL generation will fail or use mock values.");
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: filename,
      ContentType: contentType,
    });

    try {
      // URL expires in 15 minutes (900 seconds)
      const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn: 900 });
      
      const endpoint = process.env.AWS_ENDPOINT 
        ? process.env.AWS_ENDPOINT.replace(/\/$/, '') 
        : `https://s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`;
      const fileUrl = `${endpoint}/${this.bucketName}/${filename}`;
      
      return { uploadUrl, fileUrl };
    } catch (error) {
      console.error("Error generating presigned URL", error);
      throw error;
    }
  }

  /**
   * Directly uploads a buffer (such as an uploaded PDF file) to the configured S3 bucket.
   * @param buffer the binary buffer
   * @param key the desired object key in S3 (e.g. lab-reports/abc-123.pdf)
   * @param contentType file mime type (e.g. application/pdf)
   * @returns standard file URL
   */
  public static async uploadBuffer(buffer: Buffer, key: string, contentType: string = 'application/pdf'): Promise<string> {
    if (!process.env.AWS_ACCESS_KEY_ID) {
      console.warn("AWS credentials missing. S3 upload will fail or use mock values.");
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    try {
      await this.s3Client.send(command);
      const endpoint = process.env.AWS_ENDPOINT 
        ? process.env.AWS_ENDPOINT.replace(/\/$/, '') 
        : `https://s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`;
      return `${endpoint}/${this.bucketName}/${key}`;
    } catch (error) {
      console.error("Error uploading buffer to S3:", error);
      throw error;
    }
  }

  /**
   * Checks whether a URL or path refers to an S3 object (including AWS, storageapi.dev, or R2).
   */
  public static isS3Url(urlOrKey: string | null | undefined): boolean {
    if (!urlOrKey) return false;
    if (urlOrKey.startsWith('lab-reports/')) return true;
    if (urlOrKey.includes('storageapi.dev') || urlOrKey.includes('amazonaws.com')) return true;
    if (process.env.AWS_ENDPOINT) {
      try {
        const endpointHost = new URL(process.env.AWS_ENDPOINT).hostname;
        if (urlOrKey.includes(endpointHost)) return true;
      } catch (e) {}
    }
    if (process.env.AWS_S3_BUCKET && urlOrKey.includes(process.env.AWS_S3_BUCKET)) return true;
    return false;
  }

  /**
   * Generates a pre-signed URL for direct download from S3 (secures public exposure).
   * @param filename the stored filename (key) or full URL in S3
   */
  public static async generateDownloadUrl(filename: string) {
    if (!process.env.AWS_ACCESS_KEY_ID || !filename) {
       return null;
    }
    
    // Check if filename is actually a full URL (legacy). If so, extract the actual key.
    let key = filename;
    try {
      if (filename.startsWith('http://') || filename.startsWith('https://')) {
        const url = new URL(filename);
        let pathName = url.pathname.replace(/^\/+/, '');
        if (this.bucketName && pathName.startsWith(`${this.bucketName}/`)) {
          pathName = pathName.slice(this.bucketName.length + 1);
        }
        key = decodeURIComponent(pathName) || filename;
      }
    } catch (e) {}

    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });
    
    try {
      return await getSignedUrl(this.s3Client, command, { expiresIn: 900 });
    } catch (error) {
      console.error("Error generating presigned GET URL", error);
      return filename; // fallback to original
    }
  }
}

