import { google } from 'googleapis';
import { Readable } from 'stream';

let driveClient;

function client() {
  if (driveClient) return driveClient;
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey) {
    throw new Error('Google service account environment variables are missing');
  }
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_CLIENT_EMAIL,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive']
  });
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

export async function uploadFile(fileName, mimeType, base64Data) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    throw new Error('GOOGLE_DRIVE_FOLDER_ID environment variable is missing. Cannot upload media.');
  }

  const fileMetadata = {
    name: fileName,
    parents: [folderId]
  };

  // Convert base64 to stream
  const buffer = Buffer.from(base64Data, 'base64');
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);

  const media = {
    mimeType: mimeType,
    body: stream
  };

  const response = await client().files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, webViewLink, webContentLink'
  });

  return {
    fileId: response.data.id,
    fileUrl: response.data.webViewLink,
    downloadUrl: response.data.webContentLink
  };
}