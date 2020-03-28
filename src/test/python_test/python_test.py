#!/usr/bin/python3 
import os
from git import Repo
currentDirectory = os.getcwd()
r = Repo(currentDirectory)
git = r.git
repo_heads = r.heads # or it's alias: r.branches
print (git.fetch('origin'))
print (repo_heads)
print ("Sheleg")

