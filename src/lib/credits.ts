import { getPool } from "./db";

const DAILY_FREE_USES = 1;

export type CreditSource = "daily" | "bonus";

export async function checkAndConsumeCredit(
  userId: number,
): Promise<{ allowed: boolean; source?: CreditSource }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Upsert row; reset daily count if the date rolled over
    await client.query(
      `INSERT INTO user_credits (user_id, bonus, used_today, reset_date)
       VALUES ($1, 0, 0, CURRENT_DATE)
       ON CONFLICT (user_id) DO UPDATE SET
         used_today = CASE WHEN user_credits.reset_date < CURRENT_DATE THEN 0 ELSE user_credits.used_today END,
         reset_date = CURRENT_DATE`,
      [userId],
    );

    const { rows } = await client.query(
      "SELECT used_today, bonus FROM user_credits WHERE user_id = $1 FOR UPDATE",
      [userId],
    );

    const { used_today, bonus } = rows[0] as { used_today: number; bonus: number };

    if (used_today < DAILY_FREE_USES) {
      await client.query(
        "UPDATE user_credits SET used_today = used_today + 1 WHERE user_id = $1",
        [userId],
      );
      await client.query("COMMIT");
      return { allowed: true, source: "daily" };
    }

    if (bonus > 0) {
      await client.query(
        "UPDATE user_credits SET bonus = bonus - 1 WHERE user_id = $1",
        [userId],
      );
      await client.query("COMMIT");
      return { allowed: true, source: "bonus" };
    }

    await client.query("ROLLBACK");
    return { allowed: false };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function refundConsumedCredit(userId: number, source: CreditSource): Promise<void> {
  const pool = getPool();
  if (source === "daily") {
    await pool.query(
      "UPDATE user_credits SET used_today = GREATEST(used_today - 1, 0) WHERE user_id = $1",
      [userId],
    );
    return;
  }

  await pool.query(
    "UPDATE user_credits SET bonus = bonus + 1 WHERE user_id = $1",
    [userId],
  );
}

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
