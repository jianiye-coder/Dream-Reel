import { getPool } from "./db";

const DAILY_FREE_USES = 1;

export async function addBonus(userId: number, amount: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO user_credits (user_id, bonus, used_today, reset_date)
     VALUES ($1, $2, 0, CURRENT_DATE)
     ON CONFLICT (user_id) DO UPDATE SET bonus = user_credits.bonus + $2`,
    [userId, amount],
  );
}

export async function getCredits(
  userId: number,
): Promise<{ usedToday: number; dailyLimit: number; bonus: number }> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO user_credits (user_id, bonus, used_today, reset_date)
     VALUES ($1, 0, 0, CURRENT_DATE)
     ON CONFLICT (user_id) DO UPDATE SET
       used_today = CASE WHEN user_credits.reset_date < CURRENT_DATE THEN 0 ELSE user_credits.used_today END,
       reset_date = CURRENT_DATE
     RETURNING used_today, bonus`,
    [userId],
  );
  return {
    usedToday: rows[0].used_today as number,
    dailyLimit: DAILY_FREE_USES,
    bonus: rows[0].bonus as number,
  };
}
