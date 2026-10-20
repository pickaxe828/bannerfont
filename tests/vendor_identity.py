"""Identity the built font must carry. Shared by tests/code (synthetic build) and
tests/font (the real build/Font.ttf), so both suites check the same expectations."""

REPO_URL = "https://github.com/pickaxe828/bannerfont"
VENDOR_ID = "BNFT"

NAME_ID_UNIQUE_ID = 3
NAME_ID_VENDOR_URL = 11


def name_record(font, name_id):
    """The Windows / Unicode BMP / English record of `name_id`, as a string."""
    return font["name"].getName(name_id, 3, 1, 0x409).toUnicode()
