// Pure JavaScript In-Memory Full-JSON Engine for Dardcor Router
// Zero SQLite dependencies (no node:sqlite, no better-sqlite3, no sql.js).
// All data is stored in memory as JavaScript objects/arrays and persisted to modular JSON files.

import { TABLES } from "./schema.js";

export function createJsonStoreAdapter() {
  // Pre-initialize all tables declared in schema
  const tables = {};
  for (const name of Object.keys(TABLES)) {
    tables[name] = [];
  }

  // Track primary keys and unique keys
  const primaryKeys = {
    _meta: ["key"],
    settings: ["id"],
    providerConnections: ["id"],
    providerNodes: ["id"],
    proxyPools: ["id"],
    apiKeys: ["id"],
    combos: ["id"],
    kv: ["scope", "key"],
    usageHistory: ["id"],
    usageDaily: ["dateKey"],
    requestDetails: ["id"],
  };

  const uniqueKeys = {
    apiKeys: ["key"],
    combos: ["name"],
  };

  const autoIncrements = {
    usageHistory: 1,
  };

  // Track active indexes for DDL reflection
  const indexes = new Map();
  for (const [tName, def] of Object.entries(TABLES)) {
    for (const idxSql of def.indexes || []) {
      const m = idxSql.match(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)/i);
      if (m) indexes.set(m[1], { name: m[1], table: m[2] });
    }
  }

  function getTable(name) {
    if (!tables[name]) tables[name] = [];
    return tables[name];
  }

  function matchLike(text, pattern) {
    if (text === null || text === undefined) return false;
    const regStr =
      "^" +
      pattern
        .replace(/([.+^$[\](){}|\\])/g, "\\$1")
        .replace(/%/g, ".*")
        .replace(/_/g, ".") +
      "$";
    return new RegExp(regStr, "i").test(String(text));
  }

  function splitTopLevel(str, separator) {
    const parts = [];
    let current = "";
    let depth = 0;
    let inQuote = false;
    let quoteChar = "";

    const sep = separator.toUpperCase();
    const len = str.length;

    for (let i = 0; i < len; i++) {
      const ch = str[i];
      if ((ch === "'" || ch === '"') && str[i - 1] !== "\\") {
        if (!inQuote) {
          inQuote = true;
          quoteChar = ch;
        } else if (quoteChar === ch) {
          inQuote = false;
        }
      }

      if (!inQuote) {
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0) {
          if (separator === ",") {
            if (ch === ",") {
              parts.push(current);
              current = "";
              continue;
            }
          } else if (
            str.slice(i, i + sep.length).toUpperCase() === sep &&
            (i === 0 || /\s/.test(str[i - 1])) &&
            (i + sep.length === len || /\s/.test(str[i + sep.length]))
          ) {
            parts.push(current);
            current = "";
            i += sep.length - 1;
            continue;
          }
        }
      }
      current += ch;
    }
    if (current.trim()) parts.push(current);
    return parts;
  }

  function parseVal(expr, row, params, paramTracker) {
    expr = expr.trim();
    if (expr === "?") {
      const idx = paramTracker.idx++;
      return params[idx];
    }
    // Check COALESCE(col, fallback)
    const coalMatch = expr.match(/^COALESCE\s*\(([^,]+),\s*([^)]+)\)$/i);
    if (coalMatch) {
      const first = parseVal(coalMatch[1], row, params, paramTracker);
      if (first !== null && first !== undefined && first !== "") return first;
      return parseVal(coalMatch[2], row, params, paramTracker);
    }
    // String literal 'value'
    if ((expr.startsWith("'") && expr.endsWith("'")) || (expr.startsWith('"') && expr.endsWith('"'))) {
      return expr.slice(1, -1);
    }
    // Numeric literal
    if (/^-?\d+(?:\.\d+)?$/.test(expr)) {
      return Number(expr);
    }
    // NULL
    if (expr.toUpperCase() === "NULL") return null;
    // Row column reference
    if (row && Object.prototype.hasOwnProperty.call(row, expr)) {
      return row[expr];
    }
    return row ? row[expr] : undefined;
  }

  function evaluateWhereClause(whereSql, row, params, paramTracker) {
    if (!whereSql || !whereSql.trim()) return true;

    const andParts = splitTopLevel(whereSql, "AND");

    for (const part of andParts) {
      const trimmed = part.trim();
      if (!trimmed) continue;

      // Check IN subquery / literal list
      const inMatch = trimmed.match(/^([\s\S]+?)\s+(?:NOT\s+)?IN\s*\(([\s\S]+)\)$/i);
      if (inMatch) {
        const isNot = /\bNOT\s+IN\b/i.test(trimmed);
        const leftExpr = inMatch[1].trim();
        const inside = inMatch[2].trim();
        const leftVal = parseVal(leftExpr, row, params, paramTracker);

        let allowedValues = [];
        if (/^SELECT\s+/i.test(inside)) {
          // Subquery
          const subParamCount = (inside.match(/\?/g) || []).length;
          const subParams = params.slice(paramTracker.idx, paramTracker.idx + subParamCount);
          paramTracker.idx += subParamCount;
          const subRows = executeSelect(inside, subParams);
          if (subRows.length > 0) {
            const firstKey = Object.keys(subRows[0])[0];
            allowedValues = subRows.map((r) => r[firstKey]);
          }
        } else {
          // Comma-separated items: 'a', 'b' or ?, ?
          const items = splitTopLevel(inside, ",");
          for (const item of items) {
            allowedValues.push(parseVal(item.trim(), row, params, paramTracker));
          }
        }

        const found = allowedValues.some((v) => String(v) === String(leftVal) || v === leftVal);
        if (isNot ? found : !found) return false;
        continue;
      }

      // Check IS NOT NULL
      const isNotNullMatch = trimmed.match(/^([\s\S]+?)\s+IS\s+NOT\s+NULL$/i);
      if (isNotNullMatch) {
        const val = parseVal(isNotNullMatch[1], row, params, paramTracker);
        if (val === null || val === undefined) return false;
        continue;
      }

      // Check IS NULL
      const isNullMatch = trimmed.match(/^([\s\S]+?)\s+IS\s+NULL$/i);
      if (isNullMatch) {
        const val = parseVal(isNullMatch[1], row, params, paramTracker);
        if (val !== null && val !== undefined) return false;
        continue;
      }

      // Check NOT LIKE
      const notLikeMatch = trimmed.match(/^([\s\S]+?)\s+NOT\s+LIKE\s+([\s\S]+)$/i);
      if (notLikeMatch) {
        const left = parseVal(notLikeMatch[1], row, params, paramTracker);
        const right = parseVal(notLikeMatch[2], row, params, paramTracker);
        if (matchLike(left, right)) return false;
        continue;
      }

      // Check LIKE
      const likeMatch = trimmed.match(/^([\s\S]+?)\s+LIKE\s+([\s\S]+)$/i);
      if (likeMatch) {
        const left = parseVal(likeMatch[1], row, params, paramTracker);
        const right = parseVal(likeMatch[2], row, params, paramTracker);
        if (!matchLike(left, right)) return false;
        continue;
      }

      // Comparison operators: >=, <=, !=, <>, =, >, <
      const opMatch = trimmed.match(/^([\s\S]+?)\s*(>=|<=|!=|<>|=|>|<)\s*([\s\S]+)$/);
      if (opMatch) {
        const left = parseVal(opMatch[1], row, params, paramTracker);
        const op = opMatch[2];
        const right = parseVal(opMatch[3], row, params, paramTracker);

        if (op === "=") {
          if (left === null || right === null) {
            if (left !== right) return false;
          } else if (typeof left === "number" || typeof right === "number") {
            if (Number(left) !== Number(right)) return false;
          } else if (String(left) !== String(right)) {
            return false;
          }
        } else if (op === "!=" || op === "<>") {
          if (typeof left === "number" || typeof right === "number") {
            if (Number(left) === Number(right)) return false;
          } else if (String(left) === String(right)) {
            return false;
          }
        } else if (op === ">=") {
          if (!(left >= right)) return false;
        } else if (op === "<=") {
          if (!(left <= right)) return false;
        } else if (op === ">") {
          if (!(left > right)) return false;
        } else if (op === "<") {
          if (!(left < right)) return false;
        }
        continue;
      }

      // Boolean/truthy fallback
      const boolVal = parseVal(trimmed, row, params, paramTracker);
      if (!boolVal) return false;
    }

    return true;
  }

  function executeSelect(sql, params = []) {
    // 1. Check sqlite_master
    if (/FROM\s+sqlite_master/i.test(sql)) {
      const names = Object.keys(tables).filter((t) => !t.startsWith("sqlite_"));
      return names.map((name) => ({ name }));
    }

    // 2. Check PRAGMA table_info(tableName)
    const pragmaTableMatch = sql.match(/^PRAGMA\s+table_info\s*\(([a-zA-Z0-9_]+)\)/i);
    if (pragmaTableMatch) {
      const tbl = pragmaTableMatch[1];
      const def = TABLES[tbl];
      if (def && def.columns) {
        return Object.keys(def.columns).map((name, cid) => ({
          cid,
          name,
          type: "TEXT",
          notnull: 0,
          dflt_value: null,
          pk: cid === 0 ? 1 : 0,
        }));
      }
      const rows = tables[tbl] || [];
      const cols = new Set();
      if (rows.length > 0) {
        for (const k of Object.keys(rows[0])) cols.add(k);
      }
      return Array.from(cols).map((name, cid) => ({
        cid,
        name,
        type: "TEXT",
        notnull: 0,
        dflt_value: null,
        pk: cid === 0 ? 1 : 0,
      }));
    }

    // 3. Check PRAGMA index_list(tableName)
    const pragmaIdxMatch = sql.match(/^PRAGMA\s+index_list\s*\(([a-zA-Z0-9_]+)\)/i);
    if (pragmaIdxMatch) {
      const tbl = pragmaIdxMatch[1];
      const list = [];
      let seq = 0;
      for (const [idxName, meta] of indexes.entries()) {
        if (meta.table.toLowerCase() === tbl.toLowerCase()) {
          list.push({ seq: seq++, name: idxName, unique: 0, origin: "c", partial: 0 });
        }
      }
      return list;
    }

    // 4. Match SELECT ... FROM table ...
    const selectMatch = sql.match(
      /^SELECT\s+([\s\S]+?)\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+([\s\S]+?))?$/i
    );

    if (!selectMatch) {
      return [];
    }

    const selectClause = selectMatch[1].trim();
    const tableName = selectMatch[2].trim();
    const whereClause = selectMatch[3] ? selectMatch[3].trim() : "";
    const orderByClause = selectMatch[4] ? selectMatch[4].trim() : "";
    const limitClause = selectMatch[5] ? selectMatch[5].trim() : "";

    const rows = getTable(tableName);

    // Filter rows matching WHERE
    let filtered = [];
    if (!whereClause) {
      filtered = rows.slice();
    } else {
      for (const row of rows) {
        const tracker = { idx: 0 };
        if (evaluateWhereClause(whereClause, row, params, tracker)) {
          filtered.push(row);
        }
      }
    }

    // Parameters consumed by WHERE clause
    const wherePlaceholderCount = (whereClause.match(/\?/g) || []).length;
    let nextParamIdx = wherePlaceholderCount;

    // ORDER BY
    if (orderByClause) {
      const orderDirectives = splitTopLevel(orderByClause, ",").map((d) => {
        const trimmed = d.trim();
        const parts = trimmed.split(/\s+/);
        const col = parts[0];
        const desc = parts[1] && parts[1].toUpperCase() === "DESC";
        return { col, desc };
      });

      filtered.sort((a, b) => {
        for (const { col, desc } of orderDirectives) {
          const valA = a[col];
          const valB = b[col];

          if (valA === valB) continue;
          if (valA === null || valA === undefined) return desc ? 1 : -1;
          if (valB === null || valB === undefined) return desc ? -1 : 1;

          let comp = 0;
          if (typeof valA === "number" && typeof valB === "number") {
            comp = valA - valB;
          } else {
            comp = String(valA).localeCompare(String(valB));
          }

          if (comp !== 0) return desc ? -comp : comp;
        }
        return 0;
      });
    }

    // LIMIT & OFFSET
    if (limitClause) {
      let limit = Infinity;
      let offset = 0;

      const offsetMatch = limitClause.match(/^([\s\S]+?)\s+OFFSET\s+([\s\S]+)$/i);
      if (offsetMatch) {
        const lStr = offsetMatch[1].trim();
        const oStr = offsetMatch[2].trim();
        limit = lStr === "?" ? Number(params[nextParamIdx++]) : Number(lStr);
        offset = oStr === "?" ? Number(params[nextParamIdx++]) : Number(oStr);
      } else {
        limit = limitClause === "?" ? Number(params[nextParamIdx++]) : Number(limitClause);
      }

      if (!isNaN(offset) && offset > 0) {
        filtered = filtered.slice(offset);
      }
      if (!isNaN(limit) && limit >= 0) {
        filtered = filtered.slice(0, limit);
      }
    }

    // Projections
    // COUNT(*)
    const countMatch = selectClause.match(/^COUNT\s*\(\*\)(?:\s+(?:AS\s+)?([a-zA-Z0-9_]+))?$/i);
    if (countMatch) {
      const alias = countMatch[1] || "c";
      return [{ [alias]: filtered.length, n: filtered.length, c: filtered.length, "COUNT(*)": filtered.length }];
    }

    // DISTINCT col
    const distinctMatch = selectClause.match(/^DISTINCT\s+([a-zA-Z0-9_]+)$/i);
    if (distinctMatch) {
      const col = distinctMatch[1];
      const seen = new Set();
      const out = [];
      for (const r of filtered) {
        const val = r[col];
        if (!seen.has(val)) {
          seen.add(val);
          out.push({ [col]: val });
        }
      }
      return out;
    }

    // SELECT 1
    if (selectClause === "1") {
      return filtered.map(() => ({ 1: 1 }));
    }

    // SELECT *
    if (selectClause === "*") {
      return filtered.map((r) => ({ ...r }));
    }

    // Specific columns: col1, col2
    const targetCols = splitTopLevel(selectClause, ",").map((c) => c.trim());
    return filtered.map((r) => {
      const rowOut = {};
      for (const col of targetCols) {
        rowOut[col] = r[col];
      }
      return rowOut;
    });
  }

  function executeInsert(sql, params = []) {
    const insertMatch = sql.match(
      /^INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)(?:\s+ON\s+CONFLICT\s*(?:\(([^)]+)\))?\s*DO\s+UPDATE\s+SET\s+([\s\S]+))?$/i
    );
    if (!insertMatch) throw new Error(`[JsonEngine] Unsupported INSERT: ${sql}`);

    const isReplace = /^INSERT\s+OR\s+REPLACE/i.test(sql);
    const tableName = insertMatch[1].trim();
    const colList = splitTopLevel(insertMatch[2], ",").map((c) => c.trim());
    const valList = splitTopLevel(insertMatch[3], ",").map((v) => v.trim());
    const conflictCols = insertMatch[4] ? splitTopLevel(insertMatch[4], ",").map((c) => c.trim()) : null;
    const updateSetClause = insertMatch[5] ? insertMatch[5].trim() : null;

    const row = {};
    let pIdx = 0;
    for (let i = 0; i < colList.length; i++) {
      const col = colList[i];
      const valExpr = valList[i];
      if (valExpr === "?") {
        row[col] = params[pIdx++];
      } else if (/^'.*'$/.test(valExpr)) {
        row[col] = valExpr.slice(1, -1);
      } else if (/^\d+$/.test(valExpr)) {
        row[col] = Number(valExpr);
      } else {
        row[col] = valExpr;
      }
    }

    // Auto-increment support for usageHistory
    if (autoIncrements[tableName] !== undefined) {
      if (row.id === undefined || row.id === null) {
        row.id = autoIncrements[tableName]++;
      } else if (typeof row.id === "number" && row.id >= autoIncrements[tableName]) {
        autoIncrements[tableName] = row.id + 1;
      }
    }

    const tableRows = getTable(tableName);
    const pk = conflictCols || primaryKeys[tableName] || ["id"];
    const unique = uniqueKeys[tableName] || [];

    // Find existing row by primary key or unique key
    const existingIndex = tableRows.findIndex((r) => {
      // Check PK
      const pkMatch = pk.every((k) => r[k] !== undefined && row[k] !== undefined && String(r[k]) === String(row[k]));
      if (pkMatch) return true;
      // Check Unique keys
      for (const u of unique) {
        if (r[u] !== undefined && row[u] !== undefined && String(r[u]) === String(row[u])) return true;
      }
      return false;
    });

    if (existingIndex >= 0) {
      if (updateSetClause) {
        const existing = tableRows[existingIndex];
        const setAssignments = splitTopLevel(updateSetClause, ",");
        for (const assign of setAssignments) {
          const m = assign.trim().match(/^([a-zA-Z0-9_]+)\s*=\s*([\s\S]+)$/);
          if (m) {
            const targetCol = m[1].trim();
            const srcExpr = m[2].trim();
            if (srcExpr.toLowerCase().startsWith("excluded.")) {
              const srcCol = srcExpr.slice(9).trim();
              existing[targetCol] = row[srcCol];
            } else if (srcExpr === "?") {
              existing[targetCol] = params[pIdx++];
            } else {
              existing[targetCol] = parseVal(srcExpr, existing, params, { idx: pIdx });
            }
          }
        }
      } else if (isReplace || conflictCols) {
        tableRows[existingIndex] = { ...tableRows[existingIndex], ...row };
      } else {
        tableRows[existingIndex] = row;
      }
    } else {
      tableRows.push(row);
    }

    return { changes: 1, lastInsertRowid: row.id || tableRows.length };
  }

  function executeUpdate(sql, params = []) {
    const updateMatch = sql.match(/^UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (!updateMatch) throw new Error(`[JsonEngine] Unsupported UPDATE: ${sql}`);

    const tableName = updateMatch[1].trim();
    const setClause = updateMatch[2].trim();
    const whereClause = updateMatch[3] ? updateMatch[3].trim() : "";

    const tableRows = getTable(tableName);

    const setParts = splitTopLevel(setClause, ",");
    const setColCount = (setClause.match(/\?/g) || []).length;
    const setParams = params.slice(0, setColCount);
    const whereParams = params.slice(setColCount);

    let changes = 0;
    for (const row of tableRows) {
      const tracker = { idx: 0 };
      if (evaluateWhereClause(whereClause, row, whereParams, tracker)) {
        let sIdx = 0;
        for (const part of setParts) {
          const m = part.trim().match(/^([a-zA-Z0-9_]+)\s*=\s*([\s\S]+)$/);
          if (m) {
            const col = m[1].trim();
            const expr = m[2].trim();
            if (expr === "?") {
              row[col] = setParams[sIdx++];
            } else {
              row[col] = parseVal(expr, row, setParams, { idx: sIdx });
            }
          }
        }
        changes++;
      }
    }

    return { changes, lastInsertRowid: 0 };
  }

  function executeDelete(sql, params = []) {
    const deleteMatch = sql.match(/^DELETE\s+FROM\s+([a-zA-Z0-9_]+)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (!deleteMatch) throw new Error(`[JsonEngine] Unsupported DELETE: ${sql}`);

    const tableName = deleteMatch[1].trim();
    const whereClause = deleteMatch[2] ? deleteMatch[2].trim() : "";

    if (!whereClause) {
      const count = (tables[tableName] || []).length;
      tables[tableName] = [];
      return { changes: count, lastInsertRowid: 0 };
    }

    const currentRows = getTable(tableName);
    const kept = [];
    let changes = 0;

    for (const row of currentRows) {
      const tracker = { idx: 0 };
      if (evaluateWhereClause(whereClause, row, params, tracker)) {
        changes++;
      } else {
        kept.push(row);
      }
    }

    tables[tableName] = kept;
    return { changes, lastInsertRowid: 0 };
  }

  function run(sql, params = []) {
    if (!Array.isArray(params)) params = [params];
    const upper = sql.trim().toUpperCase();

    if (upper.startsWith("INSERT")) {
      return executeInsert(sql, params);
    }
    if (upper.startsWith("UPDATE")) {
      return executeUpdate(sql, params);
    }
    if (upper.startsWith("DELETE")) {
      return executeDelete(sql, params);
    }
    if (
      upper.startsWith("CREATE") ||
      upper.startsWith("DROP") ||
      upper.startsWith("ALTER") ||
      upper.startsWith("PRAGMA") ||
      upper.startsWith("BEGIN") ||
      upper.startsWith("COMMIT") ||
      upper.startsWith("ROLLBACK")
    ) {
      exec(sql);
      return { changes: 0, lastInsertRowid: 0 };
    }
    throw new Error(`[JsonEngine] Unsupported command in run(): ${sql}`);
  }

  function all(sql, params = []) {
    if (!Array.isArray(params)) params = [params];
    return executeSelect(sql, params);
  }

  function get(sql, params = []) {
    const rows = all(sql, params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  function exec(sql) {
    const stmts = sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of stmts) {
      const upper = stmt.toUpperCase();
      if (upper.startsWith("CREATE TABLE")) {
        const m = stmt.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
        if (m) getTable(m[1]);
      } else if (upper.startsWith("DROP TABLE")) {
        const m = stmt.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
        if (m) delete tables[m[1]];
      } else if (upper.startsWith("CREATE INDEX")) {
        const m = stmt.match(/CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s+ON\s+([a-zA-Z0-9_]+)/i);
        if (m) indexes.set(m[1], { name: m[1], table: m[2] });
      } else if (upper.startsWith("DROP INDEX")) {
        const m = stmt.match(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
        if (m) indexes.delete(m[1]);
      } else if (upper.startsWith("INSERT") || upper.startsWith("UPDATE") || upper.startsWith("DELETE")) {
        run(stmt, []);
      }
    }
  }

  function transaction(fn) {
    const snapshot = JSON.stringify(tables);
    const autoIncSnapshot = { ...autoIncrements };
    try {
      return fn();
    } catch (err) {
      for (const k of Object.keys(tables)) delete tables[k];
      Object.assign(tables, JSON.parse(snapshot));
      Object.assign(autoIncrements, autoIncSnapshot);
      throw err;
    }
  }

  return {
    driver: "Full JSON Store",
    tables,
    run,
    get,
    all,
    exec,
    transaction,
  };
}
