import 'dotenv/config';
process.env.NODE_ENV = 'production';
const { config } = await import('../server/config.js');
const { pool } = await import('../server/db.js');
try {
  if (process.env.DATABASE_SSL !== 'true')
    throw new Error('Set DATABASE_SSL=true for hosted PostgreSQL.');
  for (const key of ['SMTP_HOST', 'SMTP_FROM']) {
    if (!process.env[key]) throw new Error(`Set ${key} for invitation and recovery emails.`);
  }
  const result = await pool.query(`SELECT c.relname,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname IN
    ('users','sessions','attendance','attendance_proofs','payroll','auth_rate_limits')`);
  if (result.rowCount !== 6 || result.rows.some((r) => !r.relrowsecurity))
    throw new Error(
      'Run db:setup against the deployment database; required tables/RLS are missing.',
    );
  const owner = (
    await pool.query(
      "SELECT rolsuper OR rolbypassrls OR pg_has_role(current_user, (SELECT tableowner FROM pg_tables WHERE schemaname=current_schema() AND tablename='users'), 'USAGE') AS allowed FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  if (!owner?.allowed)
    throw new Error('The API connection must use the table owner or an RLS-bypass backend role.');
  if (!(await pool.query("SELECT 1 FROM users WHERE active AND role='ADMIN' LIMIT 1")).rowCount)
    throw new Error('Run admin:create to create the first administrator.');
  if (
    (await pool.query("SELECT 1 FROM users WHERE active AND email LIKE '%@edtr.local' LIMIT 1"))
      .rowCount
  )
    throw new Error('Use a production database without active demo accounts.');
  console.log(`Deployment configuration and database checks passed for ${config.appUrl}.`);
  console.log('Verify SMTP delivery and browser login after deployment.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Deployment check failed.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
