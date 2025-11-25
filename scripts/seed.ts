
import {exec} from 'child_process';
import {promisify} from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

const DATABASE_NAME = 'strava-sync';

async function executeWranglerCommand(command: string) {
  try {
    const {stdout, stderr} = await execAsync(command);
    if (stderr && !stderr.includes('WARNING')) {
      console.error(`Error executing command: ${stderr}`);
    }
    if (stdout) {
      console.log(stdout);
    }
  } catch (error) {
    console.error(`Error executing command: ${error}`);
  }
}

async function seed() {
  const schemaPath = path.resolve(__dirname, '../schema.sql');
  await executeWranglerCommand(
    `wrangler d1 execute ${DATABASE_NAME} --file ${schemaPath}`,
  );

  const createUserSql = `
    INSERT INTO users (strava_id, access_token, refresh_token, expires_at)
    VALUES (12345, 'test_access_token', 'test_refresh_token', ${Math.floor(
      (Date.now() / 1000) + 3600,
    )});
  `;

  const createActivitySql = `
    INSERT INTO activities (id, strava_id, name, distance, moving_time, elapsed_time, total_elevation_gain, type, start_date)
    VALUES (1, 12345, 'Morning Run', 5000, 1800, 1800, 100, 'Run', '2024-01-01T08:00:00Z');
  `;

  await executeWranglerCommand(
    `wrangler d1 execute ${DATABASE_NAME} --command "${createUserSql.replace(
      /\n/g,
      ' ',
    )}"`,
  );
  await executeWranglerCommand(
    `wrangler d1 execute ${DATABASE_NAME} --command "${createActivitySql.replace(
      /\n/g,
      ' ',
    )}"`,
  );
}

(async () => {
  try {
    await seed();
    console.log('Database seeded successfully.');
  } catch (error) {
    console.error('Error seeding database:', error);
  }
})();
