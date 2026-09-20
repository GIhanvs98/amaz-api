import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export class S3Service {
  private static s3Client = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
    },
  });

  private static bucketName = process.env.AWS_S3_BUCKET || "amaz-hospital-lab-reports";

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
      
      const fileUrl = `https://${this.bucketName}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${filename}`;
      
      return { uploadUrl, fileUrl };
    } catch (error) {
      console.error("Error generating presigned URL", error);
      throw error;
    }
  }
}
