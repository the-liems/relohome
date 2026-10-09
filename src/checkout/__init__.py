"""Thanh toán đa dịch vụ của app (docs/review/payment-design.md).

Thao tác có kiểu trên UI, không gọi LLM. Mỗi dịch vụ là một giao dịch riêng; mỗi lần thanh toán là một lần thử
riêng, có khóa chống trùng, đối soát khi không chắc và công việc hoàn tất lưu bền.
"""
