// Storage interface — minimal since all DB access goes through Supabase client
export interface IStorage {}

export class MemStorage implements IStorage {}

export const storage = new MemStorage();
