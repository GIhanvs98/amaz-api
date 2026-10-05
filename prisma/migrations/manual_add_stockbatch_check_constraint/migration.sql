ALTER TABLE "StockBatch" ADD CONSTRAINT "StockBatch_currentQuantity_check" CHECK ("currentQuantity" >= 0);
