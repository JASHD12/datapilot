# Machine learning method notes

## Classification
Late delivery classification compares a simple baseline with a learned model on a later temporal holdout. Accuracy can be misleading when late orders are uncommon. Read precision, recall, F1, ROC AUC, class balance, and the confusion matrix together when available. A model has no demonstrated advantage until its measured holdout result is compared with the baseline.

## Regression
Delivery-duration regression predicts a continuous number of days. Mean absolute error (MAE) is expressed in days and describes the average absolute prediction error. Root mean squared error (RMSE) gives larger errors greater weight. R squared compares squared error with a constant-mean reference; it can be negative. Report only metrics actually computed by this run.

## Validation and leakage
Temporal evaluation trains on earlier orders and holds out later orders. Fit preprocessing inside the training pipeline. Post-outcome reviews and delivered timestamps leak future information into order-time predictions. Hyperparameter choices require a validation set or inner time-aware cross-validation; a final holdout should stay untouched until evaluation.

## Retrieval evaluation
The default document retriever uses local TF-IDF lexical similarity and returns source-linked excerpts. It does not use semantic embeddings or a generative language model. Search quality should be evaluated with independently authored question/relevant-source pairs; citation presence alone does not prove an answer is supported.

## Explainability and scope
Model feature rankings describe predictive associations in the evaluated dataset. They cannot establish causal business drivers. Synthetic records can validate software behavior but cannot prove real commercial performance. Forecasting, recommendation models, streaming, and fine-tuning are future extensions unless their implementations and evaluations are present.
