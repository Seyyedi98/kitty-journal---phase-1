// expo-sqlite stand-in: every call is forwarded to a REAL node:sqlite database
// in the test runner (exposed to the page as window.__db).
import React, { createContext, useContext, useEffect, useState } from 'react';

const call = (op, sql, params) => window.__db(op, sql, params || []);
const db = {
  execAsync: (sql) => call('exec', sql),
  runAsync: (sql, ...p) => call('run', sql, p.flat()),
  getAllAsync: (sql, ...p) => call('all', sql, p.flat()),
  getFirstAsync: (sql, ...p) => call('first', sql, p.flat()),
  async withTransactionAsync(fn) {
    await call('exec', 'BEGIN');
    try {
      await fn();
      await call('exec', 'COMMIT');
    } catch (error) {
      await call('exec', 'ROLLBACK');
      throw error;
    }
  },
};
const Ctx = createContext(db);
export const useSQLiteContext = () => useContext(Ctx);
export function SQLiteProvider({ onInit, children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.resolve(onInit ? onInit(db) : null).then(() => alive && setReady(true));
    return () => { alive = false; };
  }, []);
  return ready ? <Ctx.Provider value={db}>{children}</Ctx.Provider> : null;
}
