"""Structured Moving form fields. Contacts stay in the existing private approval form."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class FormModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class MovingRequestOption(FormModel):
    request_id: str = Field(min_length=1, max_length=150)
    quantity: int | None = Field(default=None, ge=1, le=1000)
    tier_code: str | None = Field(default=None, min_length=1, max_length=100)
    option_id: str | None = Field(default=None, min_length=1, max_length=150)


class MovingPackage(FormModel):
    weight_kg: float = Field(gt=0, le=100_000, allow_inf_nan=False)
    length_cm: float | None = Field(default=None, gt=0, le=10_000, allow_inf_nan=False)
    width_cm: float | None = Field(default=None, gt=0, le=10_000, allow_inf_nan=False)
    height_cm: float | None = Field(default=None, gt=0, le=10_000, allow_inf_nan=False)
    description: str | None = Field(default=None, min_length=1, max_length=500)

    @field_validator("description")
    @classmethod
    def redact(cls, value):
        from relohome_privacy import redact_pii

        return redact_pii(value) if value else value


class MovingOptions(FormModel):
    service_id: str | None = Field(default=None, min_length=1, max_length=150)
    requests: list[MovingRequestOption] = Field(default_factory=list, max_length=50)
    packages: list[MovingPackage] = Field(default_factory=list, max_length=100)
    # Phương thức hợp lệ của AhaMove, gửi trong yêu cầu báo giá. Cách app thu tiền là field riêng `checkout_mode`
    # (payment-design D17) và không bao giờ đi vào yêu cầu gửi AhaMove.
    payment_method: Literal["CASH"] = "CASH"
    checkout_mode: Literal["app_payment"] = "app_payment"
    promo_code: str | None = Field(default=None, min_length=1, max_length=100)
    remarks: str | None = Field(default=None, max_length=1000)
    item_value: int | None = Field(default=None, ge=0)
    cod: int | None = Field(default=None, ge=0)
    require_pod: bool = False
    require_verification: bool = False

    @field_validator("remarks")
    @classmethod
    def redact(cls, value):
        from relohome_privacy import redact_pii

        return redact_pii(value) if value else value

    @model_validator(mode="after")
    def unique_requests(self):
        ids = [r.request_id for r in self.requests]
        if len(ids) != len(set(ids)) or (self.requests and not self.service_id):
            raise ValueError("Choose a service and distinct special requests")
        return self


def validated_options(raw: dict | None) -> dict:
    return MovingOptions.model_validate(raw or {}).model_dump(mode="json", exclude_none=True, exclude_defaults=True)


def apply_draft_options(draft: dict, options: dict) -> dict:
    """Same provider draft fields at estimate and re-estimate; never copy client coordinates/contacts."""
    result = dict(draft)
    for key in ("payment_method", "promo_code", "remarks", "packages"):
        if options.get(key):
            result[key] = options[key]
    result["destinations"] = [dict(p) for p in draft["destinations"]]
    for key in ("item_value", "cod", "require_pod", "require_verification"):
        if key in options:
            result["destinations"][0][key] = options[key]
    return result


def service_selection(service: dict, options: dict) -> dict:
    """Check submitted add-ons against the current provider catalog, before quoting."""
    if options.get("service_id") and options["service_id"] != service["service_id"]:
        raise ValueError("Gói xe đã thay đổi; hãy chọn lại dịch vụ.")
    if options.get("cod", 0) and service.get("cod_limit") is not None:
        if options["cod"] > service["cod_limit"]:
            raise ValueError("Tiền thu hộ vượt giới hạn của gói xe đã chọn.")
    catalog = {r.get("_id") or r.get("request_id"): r for r in service.get("requests", [])}
    selections = []
    for request in options.get("requests", []):
        item = catalog.get(request["request_id"])
        if not item or item.get("enable") is False:
            raise ValueError("Dịch vụ bổ sung không còn khả dụng; hãy chọn lại.")
        for field, key, id_key in (("tier_code", "tier_list", "code"), ("option_id", "options", "code")):
            choices = item.get(key) or []
            if choices:
                chosen = next((x for x in choices if (x.get(id_key) or x.get("_id")) == request.get(field)), None)
                if not chosen or chosen.get("selectable") is False or chosen.get("need_user_input"):
                    raise ValueError("Hãy chọn mức dịch vụ hợp lệ trong danh mục hiện tại.")
            elif request.get(field):
                raise ValueError("Mức dịch vụ không thuộc tùy chọn đã chọn.")
        if request.get("quantity") is not None and item.get("type") != "PER_UNIT":
            raise ValueError("Tùy chọn này không hỗ trợ thay đổi số lượng.")
        selections.append(dict(request))
    return {"service_id": service["service_id"], **({"requests": selections} if selections else {})}
