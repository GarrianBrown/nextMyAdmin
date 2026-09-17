export interface PrivilegeDef {
  sql: string;
  col: string;
  label: string;
  group: string;
  dbLevel: boolean;
}

export const ALL_PRIVILEGES: PrivilegeDef[] = [
  { sql: 'SELECT',                  col: 'Select_priv',           label: 'SELECT',                  group: 'Data',             dbLevel: true  },
  { sql: 'INSERT',                  col: 'Insert_priv',           label: 'INSERT',                  group: 'Data',             dbLevel: true  },
  { sql: 'UPDATE',                  col: 'Update_priv',           label: 'UPDATE',                  group: 'Data',             dbLevel: true  },
  { sql: 'DELETE',                  col: 'Delete_priv',           label: 'DELETE',                  group: 'Data',             dbLevel: true  },
  { sql: 'CREATE',                  col: 'Create_priv',           label: 'CREATE',                  group: 'Structure',        dbLevel: true  },
  { sql: 'DROP',                    col: 'Drop_priv',             label: 'DROP',                    group: 'Structure',        dbLevel: true  },
  { sql: 'ALTER',                   col: 'Alter_priv',            label: 'ALTER',                   group: 'Structure',        dbLevel: true  },
  { sql: 'INDEX',                   col: 'Index_priv',            label: 'INDEX',                   group: 'Structure',        dbLevel: true  },
  { sql: 'REFERENCES',              col: 'References_priv',       label: 'REFERENCES',              group: 'Structure',        dbLevel: true  },
  { sql: 'CREATE TEMPORARY TABLES', col: 'Create_tmp_table_priv', label: 'CREATE TEMPORARY TABLES', group: 'Structure',        dbLevel: true  },
  { sql: 'LOCK TABLES',             col: 'Lock_tables_priv',      label: 'LOCK TABLES',             group: 'Structure',        dbLevel: true  },
  { sql: 'CREATE VIEW',             col: 'Create_view_priv',      label: 'CREATE VIEW',             group: 'Views & Routines', dbLevel: true  },
  { sql: 'SHOW VIEW',               col: 'Show_view_priv',        label: 'SHOW VIEW',               group: 'Views & Routines', dbLevel: true  },
  { sql: 'CREATE ROUTINE',          col: 'Create_routine_priv',   label: 'CREATE ROUTINE',          group: 'Views & Routines', dbLevel: true  },
  { sql: 'ALTER ROUTINE',           col: 'Alter_routine_priv',    label: 'ALTER ROUTINE',           group: 'Views & Routines', dbLevel: true  },
  { sql: 'EXECUTE',                 col: 'Execute_priv',          label: 'EXECUTE',                 group: 'Views & Routines', dbLevel: true  },
  { sql: 'EVENT',                   col: 'Event_priv',            label: 'EVENT',                   group: 'Views & Routines', dbLevel: true  },
  { sql: 'TRIGGER',                 col: 'Trigger_priv',          label: 'TRIGGER',                 group: 'Views & Routines', dbLevel: true  },
  { sql: 'RELOAD',                  col: 'Reload_priv',           label: 'RELOAD',                  group: 'Admin',            dbLevel: false },
  { sql: 'SHUTDOWN',                col: 'Shutdown_priv',         label: 'SHUTDOWN',                group: 'Admin',            dbLevel: false },
  { sql: 'PROCESS',                 col: 'Process_priv',          label: 'PROCESS',                 group: 'Admin',            dbLevel: false },
  { sql: 'FILE',                    col: 'File_priv',             label: 'FILE',                    group: 'Admin',            dbLevel: false },
  { sql: 'SUPER',                   col: 'Super_priv',            label: 'SUPER',                   group: 'Admin',            dbLevel: false },
  { sql: 'CREATE USER',             col: 'Create_user_priv',      label: 'CREATE USER',             group: 'Admin',            dbLevel: false },
  { sql: 'SHOW DATABASES',          col: 'Show_db_priv',          label: 'SHOW DATABASES',          group: 'Admin',            dbLevel: false },
  { sql: 'GRANT OPTION',            col: 'Grant_priv',            label: 'GRANT OPTION',            group: 'Admin',            dbLevel: true  },
];

export const PRIVILEGE_GROUPS = ['Data', 'Structure', 'Views & Routines', 'Admin'] as const;
export const DB_PRIVILEGES = ALL_PRIVILEGES.filter(p => p.dbLevel);
