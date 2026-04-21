// src/db/prisma.ts
import 'dotenv/config'
import { createRequire } from 'node:module'
import { PrismaPg } from '@prisma/adapter-pg'

const require = createRequire(import.meta.url)
const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client')

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
export const prisma = new PrismaClient({ adapter })
