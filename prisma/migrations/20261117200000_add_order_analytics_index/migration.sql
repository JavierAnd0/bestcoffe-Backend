-- CreateIndex
CREATE INDEX "Order_tenantId_paymentStatus_createdAt_idx" ON "Order"("tenantId", "paymentStatus", "createdAt");
