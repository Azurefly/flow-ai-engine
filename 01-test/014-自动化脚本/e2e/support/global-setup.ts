import { FullConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

async function globalSetup(config: FullConfig) {
  dotenv.config({ path: '.env' });
}

export default globalSetup;