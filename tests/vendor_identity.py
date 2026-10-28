"""Identity the built font must carry. Shared by tests/code (synthetic build) and
tests/font (the real build/Font.ttf), so both suites check the same expectations."""

REPO_URL = "https://github.com/pickaxe828/bannerfont"
VENDOR_ID = "BNFT"

NAME_ID_COPYRIGHT = 0
NAME_ID_UNIQUE_ID = 3
NAME_ID_VENDOR_URL = 11
NAME_ID_LICENSE_DESCRIPTION = 13

# The notice the font must carry: the code is MIT, the textures and the font derived from
# them belong to Mojang Studios and Microsoft Corporation. Phrases, not whole sentences,
# so the wording can change without a test edit.
COPYRIGHT_PHRASES = ("Pickaxe828", "MIT", "Minecraft", "Mojang Studios", "Microsoft Corporation")
LICENSE_PHRASES = (
    "Minecraft textures", "derivatives", "Mojang Studios", "Microsoft Corporation",
    "MIT License applies to the source code only", "non-commercial", "not endorsed by")


def name_record(font, name_id):
    """The Windows / Unicode BMP / English record of `name_id`, as a string."""
    return font["name"].getName(name_id, 3, 1, 0x409).toUnicode()
