-- TOTP replay protection: remember the last accepted time step per user.
ALTER TABLE "User" ADD COLUMN "totpLastStep" INTEGER;
