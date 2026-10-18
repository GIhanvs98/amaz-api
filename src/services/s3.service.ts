import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3Service {
  private static _s3Client: S3Client | null = null;

  public static get endpoint(): string {
    return (
      process.env.AWS_ENDPOINT ||
      process.env.AWS_ENDPOINT_URL ||
      process.env.AWS_ENDPOINT_URL_S3 ||
      process.env.AWS_S3_ENDPOINT ||
      "https://t3.storageapi.dev"
    ).replace(/\/$/, "");
  }

  public static get region(): string {
    return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "auto";
  }

  public static get bucketName(): string {
    return (
      process.env.AWS_S3_BUCKET ||
      process.env.AWS_S3_BUCKET_NAME ||
      process.env.BUCKET ||
      process.env.AWS_BUCKET ||
      process.env.TIGRIS_BUCKET ||
      "integrated-cabinet-540hot"
    );
  }

  private static get s3Client(): S3Client {
    if (!this._s3Client) {
      const endpoint = this.endpoint;
      this._s3Client = new S3Client({
        region: this.region,
        ...(endpoint ? { endpoint } : {}),
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.TIGRIS_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.TIGRIS_SECRET_ACCESS_KEY || "",
        },
      });
    }
    return this._s3Client;
  }

  /**
   * Generates a pre-signed URL for direct upload from the browser to S3.
   * @param filename the desired filename
   * @param contentType the file content type (e.g., application/pdf)
   * @returns an object containing the upload URL and the final file URL
   */
  public static async generateUploadUrl(filename: string, contentType: string) {
    if (!process.env.AWS_ACCESS_KEY_ID && !process.env.TIGRIS_ACCESS_KEY_ID) {
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
      
      const fileUrl = `${this.endpoint}/${this.bucketName}/${filename}`;
      
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
    if (!process.env.AWS_ACCESS_KEY_ID && !process.env.TIGRIS_ACCESS_KEY_ID) {
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
      return `${this.endpoint}/${this.bucketName}/${key}`;
    } catch (error) {
      console.error("Error uploading buffer to S3:", error);
      throw error;
    }
  }

  /**
   * Checks whether a URL or path refers to an S3 object (including AWS, storageapi.dev, Tigris, or R2).
   */
  public static isS3Url(urlOrKey: string | null | undefined): boolean {
    if (!urlOrKey) return false;
    if (urlOrKey.startsWith('lab-reports/')) return true;
    if (
      urlOrKey.includes('storageapi.dev') ||
      urlOrKey.includes('amazonaws.com') ||
      urlOrKey.includes('tigris.dev')
    ) return true;

    if (this.endpoint) {
      try {
        const endpointHost = new URL(this.endpoint).hostname;
        if (urlOrKey.includes(endpointHost)) return true;
      } catch (e) {}
    }
    if (this.bucketName && urlOrKey.includes(this.bucketName)) return true;
    return false;
  }

  /**
   * Generates a pre-signed URL for direct download from S3 (secures public exposure).
   * @param filename the stored filename (key) or full URL in S3
   */
  public static async generateDownloadUrl(filename: string) {
    if ((!process.env.AWS_ACCESS_KEY_ID && !process.env.TIGRIS_ACCESS_KEY_ID) || !filename) {
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

