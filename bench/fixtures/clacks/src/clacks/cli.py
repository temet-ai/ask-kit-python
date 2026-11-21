import os, sys

from clacks.tower import relay


def main():
    print(relay(" ".join(sys.argv[1:]) or "GNU Terry Pratchett"))
