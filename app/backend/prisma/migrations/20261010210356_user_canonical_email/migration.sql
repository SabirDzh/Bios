-- AlterTable: canonicalEmail для дедупликации почтовых алиасов
-- (точки/плюс-теги Gmail, плюс-теги Outlook). См. canonicalizeEmail
-- в src/common/email/canonical-email.ts — SQL ниже её зеркалит.
ALTER TABLE "User" ADD COLUMN "canonicalEmail" TEXT;

-- Backfill существующих строк по тем же правилам, что canonicalizeEmail.
UPDATE "User" SET "canonicalEmail" = CASE
  WHEN split_part("email", '@', 2) IN ('gmail.com', 'googlemail.com')
   AND replace(split_part(split_part("email", '@', 1), '+', 1), '.', '') <> ''
    THEN replace(split_part(split_part("email", '@', 1), '+', 1), '.', '')
         || '@gmail.com'
  WHEN split_part("email", '@', 2) IN ('outlook.com', 'hotmail.com', 'live.com', 'msn.com')
   AND split_part(split_part("email", '@', 1), '+', 1) <> ''
    THEN split_part(split_part("email", '@', 1), '+', 1)
         || '@' || split_part("email", '@', 2)
  ELSE "email"
END;

ALTER TABLE "User" ALTER COLUMN "canonicalEmail" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "User_canonicalEmail_key" ON "User"("canonicalEmail");
