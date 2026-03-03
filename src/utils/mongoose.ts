import mongoose from 'mongoose';

declare global {
  var _mongoosePromise: Promise<typeof mongoose> | undefined;
}

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? 'signote';

if (!uri) {
  throw new Error('Missing MONGODB_URI in environment variables');
}

export const connectToDatabase = async (): Promise<typeof mongoose> => {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!global._mongoosePromise) {
    global._mongoosePromise = mongoose.connect(uri, {
      dbName,
      autoIndex: true,
    });
  }

  return global._mongoosePromise;
};

export const getMongoClientFromMongoose = async () => {
  const db = await connectToDatabase();
  return db.connection.getClient();
};

export default connectToDatabase;
