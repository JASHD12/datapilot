# Data card

The public demo uses the Olist source archive under CC BY-NC-SA 4.0. It retains 96,470 valid delivered orders for delivery-model evaluation. Forecasting separately counts all recorded statuses in the declared January 2017–21 August 2018 window, and review modeling uses 40,423 valid nonempty text reviews after earliest-answer-per-order deduplication. Dates remain historical source timestamps, not current business observations.

Only aggregates, small numeric previews, learned numeric model coefficients and 126 inspected short Portuguese review excerpts are published. Source customer/order/seller identifiers are omitted from public previews. The excerpt set favors repeated short phrases and excludes recognizable contact/address patterns; it is a demonstration evidence corpus rather than a representative review sample. Review groups reflect ratings 1–2, 3 and 4–5, which can disagree with wording.

The separate local synthetic demo contains 1,400 generated order records, seed 42. Dates span a simulated 2024–2025 period. Categories, seller identifiers, monetary amounts, distances and outcomes are invented. This fixture validates software behavior; its scores do not estimate performance on real customer data.

Order-time inputs include order value, freight, distance, item count, product category and promised days. Delivery duration, late flag and review rating are outcome fields. `outcome_available_date` records the simulated delivery time and prevents training on labels not yet available at a temporal cutoff.

For real-data experiments, use the Olist adapter when available and retain its metadata. Dataset source: [Olist Brazilian e-commerce](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce), [publisher's announcement](https://www.kaggle.com/general/67613). Raw data and prepared CSVs are ignored by Git. Preserve the publisher's license and attribution; the code license does not override dataset terms. Olist dates are historical, and filtered delivered orders do not represent all orders or unfulfilled demand.

Uploaded files are user-supplied. The application cannot verify their origin, consent, predictive validity, or permission to redistribute. The snapshot builder never exports an uploaded workspace.

