-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Membership" ("createdAt", "id", "projectId", "updatedAt", "userId") SELECT "createdAt", "id", "projectId", "updatedAt", "userId" FROM "Membership";
DROP TABLE "Membership";
ALTER TABLE "new_Membership" RENAME TO "Membership";
CREATE UNIQUE INDEX "Membership_userId_projectId_key" ON "Membership"("userId", "projectId");
CREATE TABLE "new_Task" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Task" ("assigneeId", "createdAt", "description", "id", "projectId", "status", "title", "updatedAt") SELECT "assigneeId", "createdAt", "description", "id", "projectId", "status", "title", "updatedAt" FROM "Task";
DROP TABLE "Task";
ALTER TABLE "new_Task" RENAME TO "Task";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
