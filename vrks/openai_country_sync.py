from __future__ import annotations

import hashlib
import html
import re
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime

from .errors import CLIError
from .network import normalize_country_codes


OPENAI_SUPPORTED_COUNTRIES_URL = "https://developers.openai.com/api/docs/supported-countries"

# Mapping for country names used on OpenAI's official supported-countries page.
OPENAI_COUNTRY_NAME_TO_CODE: dict[str, str] = {
    "Albania": "AL",
    "Algeria": "DZ",
    "Afghanistan": "AF",
    "Andorra": "AD",
    "Angola": "AO",
    "Antigua and Barbuda": "AG",
    "Argentina": "AR",
    "Armenia": "AM",
    "Australia": "AU",
    "Austria": "AT",
    "Azerbaijan": "AZ",
    "Bahamas": "BS",
    "Bahrain": "BH",
    "Bangladesh": "BD",
    "Barbados": "BB",
    "Belgium": "BE",
    "Belize": "BZ",
    "Benin": "BJ",
    "Bhutan": "BT",
    "Bolivia": "BO",
    "Bosnia and Herzegovina": "BA",
    "Botswana": "BW",
    "Brazil": "BR",
    "Brunei": "BN",
    "Bulgaria": "BG",
    "Burkina Faso": "BF",
    "Burundi": "BI",
    "Cabo Verde": "CV",
    "Cambodia": "KH",
    "Cameroon": "CM",
    "Canada": "CA",
    "Central African Republic": "CF",
    "Chad": "TD",
    "Chile": "CL",
    "Colombia": "CO",
    "Comoros": "KM",
    "Congo (Brazzaville)": "CG",
    "Congo (DRC)": "CD",
    "Costa Rica": "CR",
    "Côte d’Ivoire": "CI",
    "Croatia": "HR",
    "Cyprus": "CY",
    "Czechia (Czech Republic)": "CZ",
    "Denmark": "DK",
    "Djibouti": "DJ",
    "Dominica": "DM",
    "Dominican Republic": "DO",
    "Ecuador": "EC",
    "Egypt": "EG",
    "El Salvador": "SV",
    "Equatorial Guinea": "GQ",
    "Eritrea": "ER",
    "Estonia": "EE",
    "Eswatini (Swaziland)": "SZ",
    "Ethiopia": "ET",
    "Fiji": "FJ",
    "Finland": "FI",
    "France": "FR",
    "Gabon": "GA",
    "Gambia": "GM",
    "Georgia": "GE",
    "Germany": "DE",
    "Ghana": "GH",
    "Greece": "GR",
    "Grenada": "GD",
    "Guatemala": "GT",
    "Guinea": "GN",
    "Guinea-Bissau": "GW",
    "Guyana": "GY",
    "Haiti": "HT",
    "Holy See (Vatican City)": "VA",
    "Honduras": "HN",
    "Hungary": "HU",
    "Iceland": "IS",
    "India": "IN",
    "Indonesia": "ID",
    "Iraq": "IQ",
    "Ireland": "IE",
    "Israel": "IL",
    "Italy": "IT",
    "Jamaica": "JM",
    "Japan": "JP",
    "Jordan": "JO",
    "Kazakhstan": "KZ",
    "Kenya": "KE",
    "Kiribati": "KI",
    "Kuwait": "KW",
    "Kyrgyzstan": "KG",
    "Laos": "LA",
    "Latvia": "LV",
    "Lebanon": "LB",
    "Lesotho": "LS",
    "Liberia": "LR",
    "Libya": "LY",
    "Liechtenstein": "LI",
    "Lithuania": "LT",
    "Luxembourg": "LU",
    "Madagascar": "MG",
    "Malawi": "MW",
    "Malaysia": "MY",
    "Maldives": "MV",
    "Mali": "ML",
    "Malta": "MT",
    "Marshall Islands": "MH",
    "Mauritania": "MR",
    "Mauritius": "MU",
    "Mexico": "MX",
    "Micronesia": "FM",
    "Moldova": "MD",
    "Monaco": "MC",
    "Mongolia": "MN",
    "Montenegro": "ME",
    "Morocco": "MA",
    "Mozambique": "MZ",
    "Myanmar": "MM",
    "Namibia": "NA",
    "Nauru": "NR",
    "Nepal": "NP",
    "Netherlands": "NL",
    "New Zealand": "NZ",
    "Nicaragua": "NI",
    "Niger": "NE",
    "Nigeria": "NG",
    "North Macedonia": "MK",
    "Norway": "NO",
    "Oman": "OM",
    "Pakistan": "PK",
    "Palau": "PW",
    "Palestine": "PS",
    "Panama": "PA",
    "Papua New Guinea": "PG",
    "Paraguay": "PY",
    "Peru": "PE",
    "Philippines": "PH",
    "Poland": "PL",
    "Portugal": "PT",
    "Qatar": "QA",
    "Romania": "RO",
    "Rwanda": "RW",
    "Saint Kitts and Nevis": "KN",
    "Saint Lucia": "LC",
    "Saint Vincent and the Grenadines": "VC",
    "Samoa": "WS",
    "San Marino": "SM",
    "Sao Tome and Principe": "ST",
    "Saudi Arabia": "SA",
    "Senegal": "SN",
    "Serbia": "RS",
    "Seychelles": "SC",
    "Sierra Leone": "SL",
    "Singapore": "SG",
    "Slovakia": "SK",
    "Slovenia": "SI",
    "Solomon Islands": "SB",
    "Somalia": "SO",
    "South Africa": "ZA",
    "South Korea": "KR",
    "South Sudan": "SS",
    "Spain": "ES",
    "Sri Lanka": "LK",
    "Suriname": "SR",
    "Sweden": "SE",
    "Switzerland": "CH",
    "Sudan": "SD",
    "Taiwan": "TW",
    "Tajikistan": "TJ",
    "Tanzania": "TZ",
    "Thailand": "TH",
    "Timor-Leste (East Timor)": "TL",
    "Togo": "TG",
    "Tonga": "TO",
    "Trinidad and Tobago": "TT",
    "Tunisia": "TN",
    "Turkey": "TR",
    "Turkmenistan": "TM",
    "Tuvalu": "TV",
    "Uganda": "UG",
    "Ukraine (with certain exceptions)": "UA",
    "United Arab Emirates": "AE",
    "United Kingdom": "GB",
    "United States of America": "US",
    "Uruguay": "UY",
    "Uzbekistan": "UZ",
    "Vanuatu": "VU",
    "Vietnam": "VN",
    "Yemen": "YE",
    "Zambia": "ZM",
    "Zimbabwe": "ZW",
}

_ARTICLE_RE = re.compile(
    r"<article[^>]*id=[\"']mainContent[\"'][^>]*>(.*?)</article>",
    re.IGNORECASE | re.DOTALL,
)
_LIST_ITEM_RE = re.compile(r"<li[^>]*>(.*?)</li>", re.IGNORECASE | re.DOTALL)
_TAGS_RE = re.compile(r"<[^>]+>")


@dataclass
class OpenAISupportedCountriesSnapshot:
    source_url: str
    fetched_at: str
    html_sha256: str
    country_names: list[str]
    country_codes: list[str]


def _strip_tags(value: str) -> str:
    return _TAGS_RE.sub("", value).strip()


def extract_openai_supported_country_names(html_text: str) -> list[str]:
    if not html_text.strip():
        raise CLIError("OpenAI supported-countries page is empty.")

    article_match = _ARTICLE_RE.search(html_text)
    body = article_match.group(1) if article_match else html_text
    names: list[str] = []
    seen: set[str] = set()
    for raw_item in _LIST_ITEM_RE.findall(body):
        text = html.unescape(_strip_tags(raw_item))
        if not text:
            continue
        if text in seen:
            continue
        names.append(text)
        seen.add(text)

    if not names:
        raise CLIError("Unable to parse country list from OpenAI supported-countries page.")
    return names


def map_openai_country_names_to_codes(country_names: list[str]) -> tuple[list[str], list[str]]:
    codes: list[str] = []
    unmapped: list[str] = []
    for name in country_names:
        code = OPENAI_COUNTRY_NAME_TO_CODE.get(name)
        if code is None:
            unmapped.append(name)
            continue
        codes.append(code)
    return normalize_country_codes(codes), unmapped


def fetch_openai_supported_country_snapshot(timeout: int = 20) -> OpenAISupportedCountriesSnapshot:
    if timeout < 1:
        raise CLIError("Timeout must be >= 1 second.")

    request = urllib.request.Request(
        OPENAI_SUPPORTED_COUNTRIES_URL,
        headers={
            "User-Agent": "vrks-openai-country-sync/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except Exception as exc:
        raise CLIError(f"Failed to fetch OpenAI supported countries: {exc}") from exc

    html_text = payload.decode("utf-8", "ignore")
    country_names = extract_openai_supported_country_names(html_text)
    country_codes, unmapped = map_openai_country_names_to_codes(country_names)
    if unmapped:
        joined = ", ".join(unmapped[:8])
        suffix = "..." if len(unmapped) > 8 else ""
        raise CLIError(
            "OpenAI country list contains unknown names not mapped to ISO codes: "
            f"{joined}{suffix}. Update OPENAI_COUNTRY_NAME_TO_CODE."
        )
    digest = hashlib.sha256(payload).hexdigest()
    return OpenAISupportedCountriesSnapshot(
        source_url=OPENAI_SUPPORTED_COUNTRIES_URL,
        fetched_at=datetime.now(UTC).isoformat(),
        html_sha256=digest,
        country_names=country_names,
        country_codes=country_codes,
    )
