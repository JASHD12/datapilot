# Synthetic commerce data dictionary

## Dataset origin and purpose
DataPilot's bundled orders are generated synthetic demonstration data. They do not describe a real company, customer, or business outcome. The generator deliberately creates learnable relationships for software demonstrations. Good synthetic-data model performance does not establish real-world usefulness.

## Order-time features
An order_id identifies a synthetic order. purchase_date is the timestamp when the order is placed. seller_id is a synthetic seller label. category describes a broad product group. order_value, freight_value, items_count, distance_km, and promised_days are features available at order time in this demonstration. A real dataset may require a different feature-availability contract. Historical seller features, if added later, must be computed using earlier orders only.

## Targets and leakage
delivery_late is the binary classification target. delivery_days is the regression target. review_rating is known after delivery, and must not enter an order-time predictor. A delivered timestamp, if present in an imported dataset, is also a post-outcome field. A record's delivery target and review cannot explain what was known before the order was placed. Never train on targets, target-derived columns, or future observations as features.

## Time split
Sort by purchase_date and train on earlier records, then evaluate on a later holdout. Fit imputation, scaling, encoding, and feature selection on the training set only. Compare a model with a simple baseline on the same holdout. This ordered demonstration assumes outcomes of training orders were available by the evaluation period; a real deployment needs outcome-availability gaps and repeated rolling backtests.

## Interpretation
Reported metrics describe the evaluated sample and target only. Feature importance and associations do not establish causality. A high predicted risk is not proof that an order will arrive late.
