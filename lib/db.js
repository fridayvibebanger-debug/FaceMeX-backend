import mongoose from 'mongoose';

let cached = globalThis.__faceme_mongoose;

if (!cached) {
  cached = globalThis.__faceme_mongoose = { conn: null, promise: null };
}

export async function connectDb() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.warn('MONGODB_URI not set; MongoDB will not be used');
      return null;
    }

    cached.promise = mongoose
      .connect(uri, {
        maxPoolSize: 5,
      })
      .then((mongooseInstance) => mongooseInstance)
      .catch((err) => {
        console.error('MongoDB connection error', err);
        cached.promise = null;
        return null;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

export { mongoose };
