# Olist historical demonstration workspace

## Source and scope

The workspace uses the historical Brazilian E-Commerce Public Dataset published by Olist: https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce . The publisher's release announcement is https://www.kaggle.com/general/67613 . Preserve its CC BY-NC-SA 4.0 attribution and terms; the DataPilot code license does not replace the dataset license.

This is an offline demonstration using historical marketplace records. It is not a connection to a current Olist service or an endorsement by Olist. Source dates retain the source clock representation; no timezone was established from these files.

## Delivery predictions

Classification predicts whether an eligible delivered order arrived after its estimated calendar delivery date. Regression predicts observed days from purchase to delivery. Filtering to delivered orders excludes canceled and undelivered orders, so these results do not establish performance on every newly placed order. Inputs must be available at the stated prediction time. Review text, actual delivery time and rating are outcomes and must not be order-time prediction inputs.

## Review analysis

Review text is Portuguese. The text classifier predicts a rating group from the comment: ratings 1–2 are called negative, 3 neutral, and 4–5 positive. These names are proxies defined by the recorded ratings; they are not independently annotated sentiment labels. A chronological holdout uses review answer timestamps. Vocabulary and IDF are fitted on training text only.

The review analysis keeps the earliest answered review per order, then excludes missing comments or invalid ratings. This means comment authors need not represent all customers. Complaint counts use overlapping keyword rules among low-rating comments. They describe matched phrases rather than measured root causes or validated topic classifications.

## Review evidence and policies

The public evidence library contains only a bounded selection of repeated short review phrases with contact/address patterns excluded. It is a demonstration retrieval corpus, not a representative or complete review archive. Answers should identify original Portuguese excerpts and their source; DataPilot does not claim to have independently verified customer statements.

Any separate example operations policy in this repository is authored fictional demonstration material. It is not an actual Olist refund, shipping, or customer-service policy. Do not merge those fictional policy statements into claims about Olist.
