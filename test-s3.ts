import dotenv from 'dotenv';
dotenv.config();

async function run() {
  try {
    const { S3Service } = await import('./src/services/s3.service.js');
    const result = await S3Service.generateUploadUrl('test-report.pdf', 'application/pdf');
    console.log("Success:");
    console.log(result);
  } catch (error) {
    console.error("Error:", error);
  }
}

run();
