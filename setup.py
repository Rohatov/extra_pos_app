from setuptools import setup, find_packages

with open("requirements.txt") as f:
    install_requires = [
        line.strip() for line in f.read().strip().split("\n")
        if line.strip() and not line.strip().startswith("#")
    ]

# get version from __version__ variable in posawesome/__init__.py
import re

with open("posawesome/__init__.py") as f:
    version = re.search(r'__version__\s*=\s*["\']([^"\']+)["\']', f.read()).group(1)

setup(
    name="posawesome",
    version=version,
    description="POS Awesome",
    author="Youssef Restom",
    author_email="youssef@totrox.com",
    packages=find_packages(),
    zip_safe=False,
    include_package_data=True,
    install_requires=install_requires,
)
