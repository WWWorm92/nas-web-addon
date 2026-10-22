"""Register pillow-heif once so thumbnails and EXIF use the same decoder.

pillow-heif ships aarch64/x86_64 wheels containing libheif; user originals
remain on SMB and only cached browser previews are converted to WebP.
"""
from pillow_heif import register_heif_opener

# Decode the primary image rather than embedded auxiliary/thumbnail images.
register_heif_opener(thumbnails=False)
